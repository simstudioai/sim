import {
  type Principal,
  resolvePrincipalAttribution,
  resolvePrincipalSubjectUserId,
} from '@sim/auth/principal'
import { db } from '@sim/db'
import type {
  BlockCatalog,
  SourceBase,
  SourceFingerprint,
  WorkflowLockV1,
  WorkflowSourceMetaV1,
} from '@sim/workflow-code'
import { readWorkflowSourceMeta } from '@sim/workflow-persistence/source-meta'
import {
  type CatalogGate,
  resolveCatalogGate,
  withCatalogBlockScope,
} from '@/lib/catalog/application/context'
import type { ActiveWorkflowApplicationContext } from '@/lib/workflows/application/context'
import { loadStoredSource } from '@/lib/workflows/application/read-workflow-source'
import type { SourceScope } from '@/lib/workflows/application/source-pipeline/evaluate'
import { buildSourceCatalog, storedCatalogTypes } from '@/lib/workflows/code/catalog/workspace'
import { type StoredSource, storedSourceFingerprint } from '@/lib/workflows/code/print-stored'
import { loadEnvNames } from '@/lib/workflows/code/resources'
import {
  canonicalizeStored,
  prefetchStoredResources,
  type StoredCanonical,
} from '@/lib/workflows/code/stored-canonical'
import type { ActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/context'

/** The stored draft a create applies onto: an empty graph. */
const EMPTY_STORED_SOURCE: StoredSource = {
  state: { blocks: {}, edges: [], loops: {}, parallels: {}, variables: {} },
  meta: { name: '', description: null },
}

/** The empty lock a created workflow is planned with: every id is minted. */
export const EMPTY_LOCK: WorkflowLockV1 = { version: 1, blocks: {}, variables: {} }

/** Where a source write lands: an existing workflow's draft, or a new workflow `workflowId`. */
export type CommitTarget =
  | { kind: 'existing'; context: ActiveWorkflowApplicationContext }
  | {
      kind: 'new'
      workspace: ActiveWorkspaceApplicationContext
      workflowId: string
      /** The folder the workflow is created in; `null` at the workspace root. */
      folderId: string | null
    }

/**
 * What a plan evaluates against: the stored draft of an existing workflow, read at `base`, or a
 * new workflow, with an empty graph standing in for the stored one.
 */
export type SourceTarget =
  | (Extract<CommitTarget, { kind: 'existing' }> & {
      /**
       * Where and when the source was read. A `base.fingerprint` that no longer matches the draft
       * refuses as stale; a lock read in another workspace is treated as stale.
       */
      base: SourceBase
      /** Allow removing blocks and variables the source no longer declares. */
      allowDelete: boolean
    })
  | (Extract<CommitTarget, { kind: 'new' }> & {
      /** The caller's name and description, over the source's. */
      create: { name?: string; description?: string | null }
    })

/**
 * Loads that are the same for every workflow one request evaluates in one workspace for one
 * principal (a workspace source apply): each starts on first use and is reused after. Never share
 * one across principals or workspaces.
 */
export interface SourceLoads {
  catalogGate?: Promise<CatalogGate>
  envNames?: Promise<string[]>
}

/** Everything a plan reads before it evaluates: the stored draft, its catalog and fingerprint. */
export interface LoadedTarget {
  gate: CatalogGate
  catalog: BlockCatalog
  stored: StoredSource
  storedSourceMeta: WorkflowSourceMetaV1 | null
  storedCanonical: StoredCanonical
  /** The stored draft's fingerprint when loaded; a commit refuses a draft that moved off it. */
  storedFingerprint: SourceFingerprint
  envNames: string[]
  /** Attribution for resource keys the write allocates. */
  createdBy: string | null
  scope: SourceScope
}

/** The workflow a target writes and the workspace it is in. */
export function targetIds(target: CommitTarget): { workflowId: string; workspaceId: string } {
  return target.kind === 'existing'
    ? { workflowId: target.context.workflowId, workspaceId: target.context.workspaceId }
    : { workflowId: target.workflowId, workspaceId: target.workspace.workspaceId }
}

/**
 * Who and where a write to `target` acts: the human it is attributed to (the workspace's billing
 * owner for a workspace key) and the workflow's folder.
 */
export function sourceScope(principal: Principal, target: CommitTarget): SourceScope {
  const context =
    target.kind === 'existing'
      ? target.context
      : { ...target.workspace, workflowId: target.workflowId }
  return {
    workflowId: context.workflowId,
    workspaceId: context.workspaceId,
    workspaceOrganizationId: context.workspaceOrganizationId,
    subjectUserId: resolvePrincipalAttribution(principal, {
      workspaceBillingOwnerUserId: context.billedAccountUserId,
    }).attributedUserId,
    folderId: target.kind === 'existing' ? target.context.workflow.folderId : target.folderId,
  }
}

/**
 * Loads what a plan of `target` evaluates against: the catalog gate, the stored draft and its
 * source meta (an empty graph for a new workflow), its resource keys (allocating missing ones
 * only when the plan will be committed) and the env names its runs resolve. The stored draft is
 * canonicalized and fingerprinted inside the gate's block scope. `loads` shares the catalog gate
 * and env names across the workflows of one request.
 */
export async function loadSourceTarget(
  principal: Principal,
  target: SourceTarget,
  options: { loads?: SourceLoads; allocate: boolean }
): Promise<LoadedTarget> {
  const scope = sourceScope(principal, target)
  const createdBy = resolvePrincipalSubjectUserId(principal) ?? null
  const loads = options.loads ?? {}
  const context =
    target.kind === 'existing'
      ? target.context
      : { ...target.workspace, workflowId: target.workflowId }
  const [gate, stored, storedSourceMeta, prefetched, envNames] = await Promise.all([
    (loads.catalogGate ??= resolveCatalogGate(principal, context, { customBlockInputs: true })),
    target.kind === 'existing' ? loadStoredSource(target.context) : EMPTY_STORED_SOURCE,
    target.kind === 'existing' ? readWorkflowSourceMeta(db, scope.workflowId) : null,
    prefetchStoredResources({
      workflowId: scope.workflowId,
      workspaceId: scope.workspaceId,
      createdBy,
      allocate: options.allocate,
    }),
    (loads.envNames ??= loadEnvNames(scope.workspaceId, scope.subjectUserId)),
  ])
  return withCatalogBlockScope(gate, async () => {
    const catalog = buildSourceCatalog({
      gate,
      organizationId: scope.workspaceOrganizationId,
      storedTypes: storedCatalogTypes(Object.values(stored.state.blocks)),
    })
    const storedCanonical = await canonicalizeStored({
      prefetched,
      state: stored.state,
      meta: stored.meta,
      catalog,
    })
    return {
      gate,
      catalog,
      stored,
      storedSourceMeta,
      storedCanonical,
      storedFingerprint: storedSourceFingerprint(
        storedCanonical.canonical,
        storedCanonical.resources
      ),
      envNames,
      createdBy,
      scope,
    }
  })
}
