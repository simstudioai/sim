import type { Principal } from '@sim/auth/principal'
import type {
  BlockCatalog,
  SourceBase,
  SourceFingerprint,
  WorkflowLockV1,
} from '@sim/workflow-code'
import { diagnostic } from '@sim/workflow-code/diagnostics'
import { isEqual } from 'es-toolkit'
import { withCatalogBlockScope } from '@/lib/catalog/application/context'
import { assertCreateNameFree } from '@/lib/workflows/application/source-commit'
import {
  type WorkflowSourceDiagnostic,
  WorkflowSourceRejectedError,
  WorkflowSourceStaleError,
  workflowSourceStaleMessage,
} from '@/lib/workflows/application/source-error'
import {
  type CompiledReferences,
  evaluateSource,
  type PendingResource,
  type SourcePlan,
} from '@/lib/workflows/application/source-pipeline/evaluate'
import {
  type LoadedTarget,
  loadSourceTarget,
  type SourceLoads,
  type SourceTarget,
} from '@/lib/workflows/application/source-pipeline/load'
import { printPlanned } from '@/lib/workflows/application/source-pipeline/outcome'
import type { PrintedSource, StoredSource } from '@/lib/workflows/code/print-stored'

/** What a source submission carries to a plan. */
interface SourceSubmission {
  /** Repo-relative path → text: `workflow.ts` plus any function-code files it references. */
  files: Record<string, string>
  /** The identity lock returned by `source get` (or a previous apply); empty for a create. */
  lock: WorkflowLockV1
  /** Resources the enclosing workspace source apply creates or adopts first. */
  pendingResources?: readonly PendingResource[]
}

/**
 * The identity a plan is bound to: a commit refuses a plan made for another principal. The key is
 * the principal as it authenticated, so two sessions or keys of one user are two principals.
 */
export function principalKey(principal: Principal): string {
  return JSON.stringify(principal)
}

/** A plan that passed every check, bound to the workflow and principal it was made for. */
export interface PlannedSource {
  kind: 'planned'
  /** The workflow the plan writes: the stored one, or the id a create takes. */
  workflowId: string
  boundTo: { principalKey: string; principalKind: Principal['kind'] }
  /** The target the plan was evaluated against. */
  target: SourceTarget
  loaded: LoadedTarget
  plan: SourcePlan
  /**
   * For a graph no-op: the stored graph printed under the source meta the write leaves it with,
   * and whether that differs from what is stored (new idents, order or comments).
   */
  noop?: { printed: PrintedSource; sourceMetaChanged: boolean }
}

/** A plan refused: the findings, and what its dry-run answer echoes. */
export interface RefusedSource {
  kind: 'refused'
  diagnostics: WorkflowSourceDiagnostic[]
  /** Set when the draft moved off the submission's base: a commit answers 409, not 400. */
  stale?: { currentFingerprint: SourceFingerprint; workflowName: string }
  /** What the source references, when it compiled. */
  compiledReferences?: CompiledReferences
  /** The catalog and draft the plan read, and the base fingerprint a dry run echoes. */
  echo: { catalog: BlockCatalog; stored: StoredSource; fingerprint: SourceBase['fingerprint'] }
}

/** The error a write throws for a refused plan: 409 when stale, else 400 (413 over a limit). */
export function refusalError(
  refused: RefusedSource
): WorkflowSourceStaleError | WorkflowSourceRejectedError {
  return refused.stale
    ? new WorkflowSourceStaleError(refused.stale.currentFingerprint, refused.stale.workflowName)
    : new WorkflowSourceRejectedError(refused.diagnostics)
}

/**
 * Plans a source write without writing: loads the target, refuses a base read from another
 * workflow (`E_APPLY_WORKFLOW_MISMATCH`) or a draft that moved since it (`E_APPLY_STALE`), then
 * evaluates the submission onto the stored graph (empty for a new workflow). A new workflow's name
 * is checked free in its folder now, so a taken name refuses the plan, not the write (it throws
 * {@link WorkflowSourceNameTakenError}). A graph no-op is printed once here, to tell whether its
 * source meta changes. `allocate` lets the load allocate missing resource keys: set it only for a
 * plan that will be committed.
 */
export async function planSource(
  principal: Principal,
  target: SourceTarget,
  submission: SourceSubmission,
  options: { loads?: SourceLoads; allocate: boolean }
): Promise<PlannedSource | RefusedSource> {
  const loaded = await loadSourceTarget(principal, target, options)
  const { catalog, stored, storedFingerprint, scope } = loaded
  return withCatalogBlockScope(loaded.gate, async () => {
    const refuse = (
      diagnostics: WorkflowSourceDiagnostic[],
      extra: Pick<RefusedSource, 'stale' | 'compiledReferences'> = {}
    ): RefusedSource => ({
      kind: 'refused',
      diagnostics,
      ...extra,
      echo: {
        catalog,
        stored,
        fingerprint: target.kind === 'existing' ? target.base.fingerprint : storedFingerprint,
      },
    })

    if (target.kind === 'existing' && target.base.workflowId !== scope.workflowId) {
      return refuse([
        diagnostic(
          'E_APPLY_WORKFLOW_MISMATCH',
          `This source was read from workflow ${target.base.workflowId}, not ${scope.workflowId}; applying it here would overwrite a different workflow.`,
          {
            hint: 'Apply it to the workflow it was read from, or get this workflow’s source into its own directory.',
            path: '/base/workflowId',
          }
        ),
      ])
    }
    if (target.kind === 'existing' && storedFingerprint !== target.base.fingerprint) {
      return refuse([diagnostic('E_APPLY_STALE', workflowSourceStaleMessage(stored.meta.name))], {
        stale: { currentFingerprint: storedFingerprint, workflowName: stored.meta.name },
      })
    }

    const evaluation = await evaluateSource({
      principal,
      scope,
      stored,
      storedCanonical: loaded.storedCanonical,
      storedSourceMeta: loaded.storedSourceMeta,
      catalog,
      envNames: new Set(loaded.envNames),
      createdBy: loaded.createdBy,
      files: submission.files,
      lock: submission.lock,
      ...(submission.pendingResources ? { pendingResources: submission.pendingResources } : {}),
      ...(target.kind === 'existing'
        ? { base: target.base, allowDelete: target.allowDelete }
        : { create: target.create }),
    })
    if ('refused' in evaluation) {
      return refuse(
        evaluation.refused,
        evaluation.compiledReferences ? { compiledReferences: evaluation.compiledReferences } : {}
      )
    }
    const { plan } = evaluation
    const planned: PlannedSource = {
      kind: 'planned',
      workflowId: scope.workflowId,
      boundTo: { principalKey: principalKey(principal), principalKind: principal.kind },
      target,
      loaded,
      plan,
    }
    if (target.kind === 'new') {
      await assertCreateNameFree(plan, {
        workspaceId: scope.workspaceId,
        folderId: target.folderId,
      })
    }
    if (plan.noop) planned.noop = printNoop(planned)
    return planned
  })
}

/**
 * The stored graph of a graph no-op printed under the name and description the write leaves it
 * with and the source meta it stores, and whether that source meta prints differently from the
 * stored one: only changed source meta prints the "before".
 */
function printNoop(planned: PlannedSource): NonNullable<PlannedSource['noop']> {
  const { plan, loaded } = planned
  const { storedCanonical, stored, storedSourceMeta } = loaded
  const lockless =
    plan.metaChanged.length > 0
      ? {
          ...storedCanonical.canonical,
          workflow: { ...storedCanonical.canonical.workflow, meta: plan.meta },
        }
      : storedCanonical.canonical
  const printed = printPlanned(planned, stored.state, plan.sourceMeta, lockless)
  const before = isEqual(plan.sourceMeta, storedSourceMeta)
    ? printed
    : printPlanned(planned, stored.state, storedSourceMeta, lockless)
  return {
    printed,
    sourceMetaChanged: !isEqual(printed.files, before.files) || !isEqual(printed.lock, before.lock),
  }
}
