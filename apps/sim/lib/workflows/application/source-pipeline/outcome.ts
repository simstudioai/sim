import type { Principal } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import type {
  BlockCatalog,
  CanonicalizeResult,
  SourceBase,
  WorkflowLockV1,
  WorkflowSourceMetaV1,
} from '@sim/workflow-code'
import type { WorkflowState } from '@sim/workflow-types/workflow'
import { withCatalogBlockScope } from '@/lib/catalog/application/context'
import { previewSourceCommit } from '@/lib/workflows/application/source-commit'
import { emptyDiffSummary, type SourceDiffSummary } from '@/lib/workflows/application/source-diff'
import type { WorkflowSourceDiagnostic } from '@/lib/workflows/application/source-error'
import { type CommitTarget, targetIds } from '@/lib/workflows/application/source-pipeline/load'
import type { PlannedSource, RefusedSource } from '@/lib/workflows/application/source-pipeline/plan'
import { type PrintedSource, printStoredSource } from '@/lib/workflows/code/print-stored'
import {
  checkDraftNeedsRedeployment,
  checkNeedsRedeployment,
} from '@/lib/workflows/deployment-status'

const logger = createLogger('ApplyWorkflowSource')

/** The outcome of a source write, its dry run or its plan, as the use cases return it. */
export interface SourceOutcome {
  workflowId: string
  workflowName: string
  workspaceId: string
  dryRun: boolean
  /** True when the apply wrote a graph, or renamed or redescribed the workflow. */
  applied: boolean
  /** True when source meta was stored: with a graph write, or alone for a graph no-op. */
  wroteSourceMeta: boolean
  diff: SourceDiffSummary
  /** Warnings on success; on a dry run, every finding including the errors a commit would refuse. */
  diagnostics: WorkflowSourceDiagnostic[]
  /** Re-printed from what is (or would be) stored, so normalized values show in the source. */
  files: Record<string, string>
  lock: WorkflowLockV1
  /** Where what is (or would be) stored was read: the next apply's `base`. */
  base: SourceBase
  /** Source key → id for every new block whose id was minted rather than taken from the lock. */
  mintedIds: Record<string, string>
  notes: string[]
  needsRedeployment: boolean
  sdkMajor: number
}

/** Whose outcome is shaped: the workflow, whether it is a dry run, and the draft it was read on. */
interface OutcomeFrame {
  target: CommitTarget
  dryRun: boolean
  catalog: BlockCatalog
  /** The stored workflow's name, which the outcome reports unless the write gives another. */
  storedName: string
}

/** What an outcome reports beyond its frame and the printed source; the rest default to empty. */
type OutcomeFields = Pick<SourceOutcome, 'applied' | 'diff' | 'diagnostics' | 'needsRedeployment'> &
  Partial<Pick<SourceOutcome, 'workflowName' | 'mintedIds' | 'notes' | 'wroteSourceMeta'>>

/** The one outcome shape: what is (or would be) stored, printed, and what the write did. */
export function shapeOutcome(
  frame: OutcomeFrame,
  printed: Pick<PrintedSource, 'files' | 'lock'> & Pick<SourceBase, 'fingerprint'>,
  outcome: OutcomeFields
): SourceOutcome {
  const { workflowId, workspaceId } = targetIds(frame.target)
  return {
    workflowId,
    workflowName: frame.storedName,
    workspaceId,
    dryRun: frame.dryRun,
    mintedIds: {},
    notes: [],
    wroteSourceMeta: false,
    ...outcome,
    files: printed.files,
    lock: printed.lock,
    base: {
      version: 1,
      workflowId,
      workspaceId,
      fingerprint: printed.fingerprint,
      catalogHash: frame.catalog.hash,
    },
    sdkMajor: frame.catalog.sdkMajor,
  }
}

/**
 * Prints `state` as the plan's write would leave it, under the keys and function files the
 * submission bound, as the next `source get` will. `lockless` is the state already canonicalized.
 */
export function printPlanned(
  { plan, loaded }: Pick<PlannedSource, 'plan' | 'loaded'>,
  state: WorkflowState,
  sourceMeta: WorkflowSourceMetaV1 | null,
  lockless?: CanonicalizeResult
): PrintedSource {
  /** The function files the submission named, kept so a write never renames the author's. */
  const codeFiles: Record<string, string> = {}
  for (const [key, hint] of Object.entries(plan.compiled.hints.blocks)) {
    if (hint.codeFile !== undefined) codeFiles[key] = hint.codeFile
  }
  return printStoredSource({
    state,
    meta: plan.meta,
    catalog: loaded.catalog,
    resources: plan.resources,
    sourceMeta,
    functionCode: plan.functionCode,
    identity: plan.identity,
    codeFiles,
    ...(lockless ? { lockless } : {}),
  })
}

/** Prints the blocks and edges a write stores with the plan's variables and source meta. */
export function printWritten(
  planned: Pick<PlannedSource, 'plan' | 'loaded'>,
  written: Omit<WorkflowState, 'variables'>
): PrintedSource {
  return printPlanned(
    planned,
    { ...written, variables: planned.plan.storedVariables },
    planned.plan.sourceMeta
  )
}

/**
 * Whether the draft as it is differs from its deployment, for a dry run that leaves it so (a no-op
 * or a refusal); a new workflow has none. Run only once the plan says so: a dry run that would
 * change the draft compares what it would write instead.
 */
async function draftNeedsRedeployment(target: CommitTarget): Promise<boolean> {
  return target.kind === 'new' ? false : checkNeedsRedeployment(target.context.workflowId)
}

/**
 * The dry run of a plan: what a commit would store, re-printed, and whether the draft would then
 * differ from its deployment. A graph no-op reports the source meta a commit would store, and the
 * deployment check of the draft as it is.
 */
export async function previewSource(
  principal: Principal,
  planned: PlannedSource
): Promise<SourceOutcome> {
  const { plan, loaded, target } = planned
  const frame = {
    target,
    dryRun: true,
    catalog: loaded.catalog,
    storedName: loaded.stored.meta.name,
  }
  const isNew = target.kind === 'new'
  return withCatalogBlockScope(loaded.gate, async () => {
    if (planned.noop) {
      return shapeOutcome(frame, planned.noop.printed, {
        applied: false,
        workflowName: plan.meta.name,
        diff: plan.diff,
        diagnostics: plan.diagnostics,
        needsRedeployment: await draftNeedsRedeployment(target),
      })
    }
    const preview = await previewSourceCommit(planned.workflowId, plan)
    logger.info('Evaluated workflow source without persisting', {
      workflowId: planned.workflowId,
      workspaceId: loaded.scope.workspaceId,
      principalKind: principal.kind,
    })
    return shapeOutcome(frame, printWritten(planned, preview.state), {
      applied: false,
      needsRedeployment:
        !isNew &&
        (await checkDraftNeedsRedeployment(planned.workflowId, {
          ...preview.state,
          variables: plan.storedVariables,
        })),
      diff: plan.diff,
      diagnostics: plan.diagnostics,
      mintedIds: plan.mintedIds,
      notes: preview.warnings,
      workflowName: plan.meta.name,
    })
  })
}

/**
 * The dry-run answer for a refused plan: its findings with a 200, echoing the submission. It echoes
 * the caller's own base fingerprint, so applying its response after a stale or mismatched read
 * still fails the freshness check rather than overwriting the newer draft, and the deployment check
 * of the draft as it is.
 */
export async function refusedOutcome(
  refused: RefusedSource,
  target: CommitTarget,
  submission: { files: Record<string, string>; lock: WorkflowLockV1 }
): Promise<SourceOutcome> {
  return shapeOutcome(
    {
      target,
      dryRun: true,
      catalog: refused.echo.catalog,
      storedName: refused.echo.stored.meta.name,
    },
    { files: submission.files, lock: submission.lock, fingerprint: refused.echo.fingerprint },
    {
      applied: false,
      diff: emptyDiffSummary(),
      diagnostics: refused.diagnostics,
      needsRedeployment: await draftNeedsRedeployment(target),
    }
  )
}
