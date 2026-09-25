import { type CostLedger, traceSpansSchema } from '@/lib/api/contracts/logs'
import { type V2LogDetail, v2GetLogContract, v2LogStatusSchema } from '@/lib/api/contracts/v2/logs'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2LogErrorPolicies } from '@/lib/logs/api/route-policies'
import { getPublicLog } from '@/lib/logs/application/get-public-log'
import { logOperations } from '@/lib/logs/application/operations'
import { withSpanDurationMs } from '@/lib/logs/execution/trace-spans/trace-spans'
import { projectLogFiles } from '@/lib/logs/log-files'

export const revalidate = 0

/**
 * The run's cost as the contract defines it, from the projected total and the
 * itemized ledger.
 *
 * The projection wins when both exist: it is what every other surface reports
 * for the run, and the ledger folds its lines, so a rounding difference between
 * the two must not make one endpoint disagree with the rest.
 */
function buildCostProjection(
  costTotal: string | null,
  costLedger: CostLedger | null
): V2LogDetail['cost'] {
  if (costTotal != null) return { total: Number(costTotal), items: costLedger?.items ?? null }
  if (costLedger) return { total: costLedger.total, items: costLedger.items }
  return null
}

/**
 * Returns the diagnostic representation of a run. The run ID is the sole
 * public identity; canonical workflow and workspace scope come from the run.
 */
export const GET = defineV2JsonRoute({
  contract: v2GetLogContract,
  auth: v2ApiKeyAuth,
  operation: logOperations.readDetail,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2LogErrorPolicies.concealDetailAuthorization,
  mapInput: ({ params }) => ({ runId: params.runId }),
  useCase: getPublicLog,
  present: ({ log, workflowFolderPath, executionData, costLedger }) => {
    const detail: V2LogDetail = {
      runId: log.executionId,
      workflowId: log.workflowId,
      deploymentVersionId: log.deploymentVersionId,
      status: v2LogStatusSchema.parse(log.status),
      level: log.level,
      trigger: log.trigger,
      startedAt: log.startedAt.toISOString(),
      endedAt: log.endedAt ? log.endedAt.toISOString() : null,
      totalDurationMs: log.totalDurationMs,
      files: projectLogFiles(log),
      executedByEmail: log.executedByEmail,
      workflow: {
        id: log.workflowId,
        name: log.workflowName || 'Deleted Workflow',
        description: log.workflowDescription,
        folderPath: workflowFolderPath,
        /** Deprecated in favour of the run-level `executedByEmail`. */
        ownerEmail: log.workflowOwnerEmail,
        workspaceId: log.workflowWorkspaceId,
        createdAt: log.workflowCreatedAt ? log.workflowCreatedAt.toISOString() : null,
        updatedAt: log.workflowUpdatedAt ? log.workflowUpdatedAt.toISOString() : null,
        deleted: !log.workflowName || log.workflowArchivedAt !== null,
      },
      workflowState: log.workflowState,
      traceSpans: withSpanDurationMs(traceSpansSchema.parse(executionData.traceSpans ?? [])),

      finalOutput: executionData.finalOutput ?? null,
      /**
       * `cost_total` is a backfilled projection of the ledger, so it is null on
       * runs that predate the backfill even when `usage_log` holds real billed
       * lines for them. Keying `cost` on the projection alone reported
       * `cost: null` for those runs — which the contract defines as "no cost
       * information", not "no itemization" — and made `items` unreachable for
       * exactly the runs the ledger exists to explain. The ledger's own total
       * is the fallback; `null` now means neither source has anything.
       */
      cost: buildCostProjection(log.costTotal, costLedger),
      workflowInput: executionData.workflowInput ?? null,
      createdAt: log.createdAt.toISOString(),
    }
    return { data: detail }
  },
})
