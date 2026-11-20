import type { Principal } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { withCatalogBlockScope } from '@/lib/catalog/application/context'
import type { DbTransaction } from '@/lib/db/types'
import {
  commitSourceCreate,
  commitSourceMeta,
  commitSourceReplace,
} from '@/lib/workflows/application/source-commit'
import {
  type CommitTarget,
  sourceScope,
  targetIds,
} from '@/lib/workflows/application/source-pipeline/load'
import {
  printWritten,
  type SourceOutcome,
  shapeOutcome,
} from '@/lib/workflows/application/source-pipeline/outcome'
import {
  assertPlannedBy,
  PlanBindingError,
  type PlannedSource,
} from '@/lib/workflows/application/source-pipeline/plan'
import { checkNeedsRedeployment } from '@/lib/workflows/deployment-status'

const logger = createLogger('ApplyWorkflowSource')

/**
 * Commits a plan to `target`, the workflow it was planned for, as the principal it was planned
 * by: a plan made for another workflow or principal throws `PlanBindingError` before anything is
 * written. A graph no-op stores only its source meta, name and description (and nothing when none
 * changed); an existing draft is replaced under the workflow row lock, which re-checks the plan's
 * fingerprint (409 when the draft moved); a new workflow is inserted with its graph in one
 * transaction, with `withinCreate` run inside it.
 */
export async function commitSource(
  principal: Principal,
  planned: PlannedSource,
  target: CommitTarget,
  options: { withinCreate?: (tx: DbTransaction, workflowId: string) => Promise<void> } = {}
): Promise<SourceOutcome> {
  const { workflowId, workspaceId } = targetIds(target)
  if (planned.workflowId !== workflowId || planned.target.kind !== target.kind) {
    throw new PlanBindingError(
      'PLAN_WORKFLOW_MISMATCH',
      'A planned source commits only to the workflow it was planned for'
    )
  }
  assertPlannedBy(principal, planned)
  const { plan, loaded } = planned
  const { catalog, stored, storedFingerprint } = loaded
  const scope = sourceScope(principal, target)
  const frame = { target, dryRun: false, catalog, storedName: stored.meta.name }
  const logContext = { workflowId, workspaceId, principalKind: principal.kind }
  return withCatalogBlockScope(loaded.gate, async () => {
    if (planned.noop) {
      if (target.kind !== 'existing') throw new Error('A created workflow is never a graph no-op')
      const { printed, sourceMetaChanged } = planned.noop
      const renamed = plan.metaChanged.length > 0
      if (sourceMetaChanged || renamed) {
        await commitSourceMeta({ scope, plan, stored, storedFingerprint, catalog })
      }
      return shapeOutcome(frame, printed, {
        applied: renamed,
        workflowName: plan.meta.name,
        diff: plan.diff,
        diagnostics: plan.diagnostics,
        wroteSourceMeta: sourceMetaChanged,
        needsRedeployment: await checkNeedsRedeployment(workflowId),
      })
    }

    const committed =
      target.kind === 'new'
        ? await commitSourceCreate({
            scope,
            plan,
            folderId: target.folderId,
            ...(options.withinCreate ? { withinCreate: options.withinCreate } : {}),
          })
        : {
            ...(await commitSourceReplace({ scope, plan, stored, storedFingerprint, catalog })),
            name: plan.meta.name,
          }
    logger.info(
      target.kind === 'new' ? 'Created workflow from source' : 'Applied workflow source',
      logContext
    )
    return shapeOutcome(frame, printWritten(planned, committed.state), {
      applied: true,
      wroteSourceMeta: true,
      diff: plan.diff,
      diagnostics: plan.diagnostics,
      mintedIds: plan.mintedIds,
      workflowName: committed.name,
      notes: committed.warnings,
      needsRedeployment: target.kind === 'new' ? false : await checkNeedsRedeployment(workflowId),
    })
  })
}
