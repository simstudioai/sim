import { db } from '@sim/db'
import { workflowBlocks } from '@sim/db/schema'
import { isRecordLike } from '@sim/utils/object'
import {
  type CanonicalizeResult,
  canonicalize,
  canonicalizeUnderLock,
  type Diagnostic,
  encodeAnchor,
  isResourceKind,
  type MaterializeResult,
  materialize,
  type ResourceKeyResolver,
  type ResourceKind,
  type SourceSpan,
  type WorkflowLockBlock,
  type WorkflowLockV1,
} from '@sim/workflow-code'
import { diagnostic } from '@sim/workflow-code/diagnostics'
import { and, inArray, ne } from 'drizzle-orm'
import { resolvePermissionGroupConfig } from '@/lib/permission-groups/config-scope.server'
import type { WorkflowSourceDiagnostic } from '@/lib/workflows/application/source-error'
import { createLocator, hasErrors } from '@/lib/workflows/application/source-locate'
import type { CompiledSubmission } from '@/lib/workflows/application/source-pipeline/evaluate/compile'
import type {
  CompiledReferences,
  PendingResource,
  SourceEvaluationInput,
  SourceReference,
} from '@/lib/workflows/application/source-pipeline/evaluate/types'
import { keptCredentials } from '@/lib/workflows/code/credential-nodes'
import { createMaterializeHooks } from '@/lib/workflows/code/materialize-hooks'
import { loadAvailableResourceKeys, loadResourceKeyResolver } from '@/lib/workflows/code/resources'

/**
 * `primary`, falling back to `fallback` for a key, id or name it does not resolve. Whether an id
 * is built in is `primary`'s answer alone.
 */
function withFallback(
  primary: ResourceKeyResolver,
  fallback: Pick<ResourceKeyResolver, 'toKey' | 'toId' | 'nameOf'>
): ResourceKeyResolver {
  return {
    toKey: (kind, id) => primary.toKey(kind, id) ?? fallback.toKey(kind, id),
    toId: (kind, key) => primary.toId(kind, key) ?? fallback.toId(kind, key),
    nameOf: (kind, id) => primary.nameOf?.(kind, id) ?? fallback.nameOf?.(kind, id) ?? null,
    isBuiltin: primary.isBuiltin,
  }
}

/** `resources`, falling back to `pending` for a key, id or name it does not resolve. */
function withPendingResources(
  resources: ResourceKeyResolver,
  pending: readonly PendingResource[]
): ResourceKeyResolver {
  if (pending.length === 0) return resources
  const byId = (kind: ResourceKind, id: string) =>
    pending.find((entry) => entry.kind === kind && entry.id === id)
  return withFallback(resources, {
    toKey: (kind, id) => byId(kind, id)?.key ?? null,
    toId: (kind, key) =>
      pending.find((entry) => entry.kind === kind && entry.key === key)?.id ?? null,
    nameOf: (kind, id) => byId(kind, id)?.name ?? null,
  })
}

/**
 * Every `(kind, key)` resource reference in a compiled model, for ident lookup, and the tool each
 * MCP agent tool (`mcp(key).tool(name)`) names on its server.
 */
function collectResourceKeys(
  value: unknown,
  refs: SourceReference[],
  span: SourceSpan | undefined
): void {
  if (Array.isArray(value)) {
    for (const item of value) collectResourceKeys(item, refs, span)
    return
  }
  if (value === null || typeof value !== 'object') return
  const record = value as Record<string, unknown>
  if (
    record.$sim === 'resource' &&
    typeof record.kind === 'string' &&
    isResourceKind(record.kind) &&
    typeof record.key === 'string'
  ) {
    refs.push({ kind: record.kind, key: record.key })
  }
  const tool = mcpToolReference(record)
  if (tool) refs.push(span ? { ...tool, span } : tool)
  for (const nested of Object.values(record)) collectResourceKeys(nested, refs, span)
}

/** The server and tool an MCP agent tool entry names, or `null` for anything else. */
function mcpToolReference(record: Record<string, unknown>): SourceReference | null {
  if (record.type !== 'mcp' || !isRecordLike(record.params)) return null
  const { serverId, toolName } = record.params
  if (
    !isRecordLike(serverId) ||
    serverId.$sim !== 'resource' ||
    serverId.kind !== 'mcp-server' ||
    typeof serverId.key !== 'string' ||
    typeof toolName !== 'string'
  ) {
    return null
  }
  return { kind: 'mcp-server', key: serverId.key, member: toolName }
}

/** Block ids another workflow already stores, among `ids`. */
async function findBlockIdsClaimedElsewhere(workflowId: string, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return []
  const rows = await db
    .select({ id: workflowBlocks.id })
    .from(workflowBlocks)
    .where(and(inArray(workflowBlocks.id, ids), ne(workflowBlocks.workflowId, workflowId)))
  return rows.map((row) => row.id)
}

/** The resolve phase's result: the compiled source materialized onto the stored graph. */
export interface ResolvedSubmission {
  /** Answers every resource reference of the stored and submitted source, pending ones included. */
  resources: ResourceKeyResolver
  /** The stored graph under the lock, re-read under the keys of any credential the source keeps. */
  storedCanonical: CanonicalizeResult
  /** Every resource the compiled source names by key. */
  compiledKeys: SourceReference[]
  /** `W_APPLY_CREDENTIAL_KEPT` for each stored credential kept under a key the subject cannot see. */
  keptDiagnostics: Diagnostic[]
  materialized: MaterializeResult
  /** Materialize's findings and the lock ids it could not reuse. */
  materializeDiagnostics: Diagnostic[]
  permissionConfig: Awaited<ReturnType<typeof resolvePermissionGroupConfig>>
  /** Block id by the key this write binds. */
  idByKey: Map<string, string>
  /** Block key by the id this write binds. */
  keyById: Map<string, string>
  /** A block's source key: the one this write binds, else the stored one for a removed block. */
  keyOf: (id: string) => string | undefined
  /** Pins a finding to the submitted files. */
  locate: ReturnType<typeof createLocator>
}

/**
 * Resolves the resources the compiled source names (stored keys, then keys new to it, then the
 * stored credentials it keeps, then what an enclosing apply creates first) and materializes it
 * onto the stored graph, keeping every id the lock binds that no other workflow stores. Refuses
 * the materialize errors, with what the source references.
 */
export async function resolveSubmission(
  input: SourceEvaluationInput,
  submission: CompiledSubmission
): Promise<
  | { refused: WorkflowSourceDiagnostic[]; compiledReferences: CompiledReferences }
  | ResolvedSubmission
> {
  const { scope, catalog, files } = input
  const { lock, compiled, compiledWorkflow, meta } = submission
  const { state } = input.stored
  let { storedCanonical } = submission
  let resources = input.storedCanonical.resources

  const compiledKeys: SourceReference[] = []
  for (const [key, block] of Object.entries(compiledWorkflow.blocks)) {
    const span =
      compiled.spans[encodeAnchor({ kind: 'param', block: key, param: 'tools' })] ??
      compiled.spans[encodeAnchor({ kind: 'block', block: key })]
    collectResourceKeys(block, compiledKeys, span)
  }
  const storedResources = resources
  const newKeys = compiledKeys.filter(({ kind, key }) => storedResources.toId(kind, key) === null)
  if (newKeys.length > 0) {
    const extra = await loadResourceKeyResolver(
      scope.workspaceId,
      { keys: newKeys },
      { actorUserId: input.createdBy }
    )
    resources = withFallback(storedResources, extra)
  }

  const kept = keptCredentials(
    compiledWorkflow,
    compiled.stored,
    (key) =>
      resources.toId('credential', key) === null &&
      !(input.pendingResources ?? []).some(
        (entry) => entry.kind === 'credential' && entry.key === key
      )
  )
  if (kept.length > 0) {
    const idsByKey = new Map(kept.map(({ key, id }) => [key, id]))
    const keysById = new Map(kept.map(({ key, id }) => [id, key]))
    resources = withFallback(resources, {
      toKey: (kind, id) => (kind === 'credential' ? (keysById.get(id) ?? null) : null),
      toId: (kind, key) => (kind === 'credential' ? (idsByKey.get(key) ?? null) : null),
    })
    // The stored graph under the keys the source gives its kept credentials: no change there.
    storedCanonical = canonicalizeUnderLock(
      state,
      { catalog, meta, resources },
      canonicalize(state, { catalog, meta, resources }),
      lock
    )
  }
  const keptDiagnostics: Diagnostic[] = kept.map(({ key, blockKey }) =>
    diagnostic(
      'W_APPLY_CREDENTIAL_KEPT',
      `credential(${JSON.stringify(key)}) stands where the workflow stores a credential you cannot see, so that credential is kept as stored.`,
      {
        hint: 'Name a credential you can see to change it, or ask a member who can see the stored one.',
        blockKey,
      }
    )
  )

  resources = withPendingResources(resources, input.pendingResources ?? [])

  const hasLockEntries =
    Object.keys(lock.blocks).length > 0 || Object.keys(lock.variables).length > 0
  const lockFreshness: 'fresh' | 'stale' | 'none' = !hasLockEntries
    ? 'none'
    : input.base && input.base.workspaceId !== scope.workspaceId
      ? 'stale'
      : 'fresh'
  const compiledIdents: Record<string, string> = {}
  for (const [key, hint] of Object.entries(compiled.hints.blocks)) {
    if (hint.ident !== undefined) compiledIdents[key] = hint.ident
  }
  const hooks = createMaterializeHooks()
  const prevCanonical = storedCanonical
  const materializeWith = (withLock: WorkflowLockV1): MaterializeResult =>
    materialize(compiledWorkflow, withLock, {
      catalog,
      hooks,
      prev: state,
      prevCanonical,
      resources,
      compiledIdents,
      lockFreshness,
    })

  /**
   * A lock id for a new block that another workflow already stores cannot be reused (block ids
   * are global keys): drop it from the lock so materialize mints one, and say so.
   */
  let materialized = materializeWith(lock)
  if (materialized.diagnostics.some((d) => d.code === 'E_MAT_UNKNOWN_RESOURCE')) {
    // Only on a miss: list the keys the source could have named, for the finding's did-you-mean.
    const missingKinds = compiledKeys
      .filter(({ kind, key }) => resources.toId(kind, key) === null)
      .map(({ kind }) => kind)
    if (missingKinds.length > 0) {
      const available = await loadAvailableResourceKeys(
        scope.workspaceId,
        missingKinds,
        input.createdBy
      )
      const known = resources
      resources = { ...known, keysOf: (kind) => available.get(kind) }
      materialized = materializeWith(lock)
    }
  }
  const claimedDiagnostics: Diagnostic[] = []
  const lockSuppliedIds = materialized.entries.flatMap((entry) =>
    entry.status === 'created' && entry.idSource === 'lock' ? [entry.id] : []
  )
  const [claimedIds, permissionConfig] = await Promise.all([
    findBlockIdsClaimedElsewhere(scope.workflowId, lockSuppliedIds),
    resolvePermissionGroupConfig(
      scope.subjectUserId,
      scope.workspaceId,
      scope.workspaceOrganizationId
    ),
  ])
  const claimed = new Set(claimedIds)
  if (claimed.size > 0) {
    const blocks: Record<string, WorkflowLockBlock> = {}
    const claimedKeys: string[] = []
    for (const [key, entry] of Object.entries(lock.blocks)) {
      if (claimed.has(entry.id)) claimedKeys.push(key)
      else blocks[key] = entry
    }
    materialized = materializeWith({ ...lock, blocks })
    // Without its lock id the block binds as a lockless one would: to the stored block of its
    // name, or to a new id.
    const outcomes = new Map(materialized.entries.map((entry) => [entry.key, entry]))
    for (const key of claimedKeys) {
      const kept = outcomes.get(key)?.status === 'matched'
      claimedDiagnostics.push(
        diagnostic(
          'W_MAT_LOCK_ID_CLAIMED',
          `The lock id for block "${key}" belongs to another workflow, so it was ignored; ${kept ? 'the block keeps the id of the stored block it matches' : 'a new id was minted'}`,
          { blockKey: key }
        )
      )
    }
  }

  const idByKey = new Map(
    Object.entries(materialized.identity.blocks).map(([key, block]) => [key, block.id])
  )
  const keyById = new Map([...idByKey].map(([key, id]) => [id, key]))
  const storedKeyById = new Map(
    Object.entries(storedCanonical.identity.blocks).map(([key, block]) => [block.id, key])
  )
  const keyOf = (id: string) => keyById.get(id) ?? storedKeyById.get(id)
  const locate = createLocator(files, compiled.spans, idByKey)
  const materializeDiagnostics = [...materialized.diagnostics, ...claimedDiagnostics]
  if (hasErrors(materializeDiagnostics)) {
    return {
      refused: [...compiled.diagnostics, ...materializeDiagnostics].map(locate),
      compiledReferences: { references: compiledKeys, envReferences: compiled.envReferences },
    }
  }
  return {
    resources,
    storedCanonical,
    compiledKeys,
    keptDiagnostics,
    materialized,
    materializeDiagnostics,
    permissionConfig,
    idByKey,
    keyById,
    keyOf,
    locate,
  }
}
