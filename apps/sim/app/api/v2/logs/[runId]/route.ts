import { traceSpansSchema } from '@/lib/api/contracts/logs'
import { type V2LogDetail, v2GetLogContract, v2LogStatusSchema } from '@/lib/api/contracts/v2/logs'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2LogErrorPolicies } from '@/lib/logs/api/route-policies'
import { getPublicLog } from '@/lib/logs/application/get-public-log'
import { logOperations } from '@/lib/logs/application/operations'

export const revalidate = 0

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
  present: ({ log, workflowFolderPath, executionData }) => {
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
      files: (log.files as unknown[] | null) ?? null,
      workflow: {
        id: log.workflowId,
        name: log.workflowName || 'Deleted Workflow',
        description: log.workflowDescription,
        folderPath: workflowFolderPath,
        ownerEmail: log.workflowOwnerEmail,
        workspaceId: log.workflowWorkspaceId,
        createdAt: log.workflowCreatedAt ? log.workflowCreatedAt.toISOString() : null,
        updatedAt: log.workflowUpdatedAt ? log.workflowUpdatedAt.toISOString() : null,
        deleted: !log.workflowName || log.workflowArchivedAt !== null,
      },
      workflowState: log.workflowState,
      traceSpans: traceSpansSchema.parse(executionData.traceSpans ?? []),
      finalOutput: executionData.finalOutput ?? null,
      cost: log.costTotal != null ? { total: Number(log.costTotal) } : null,
      createdAt: log.createdAt.toISOString(),
    }
    return { data: detail }
  },
})
