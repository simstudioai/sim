import { traceSpansSchema } from '@/lib/api/contracts/logs'
import { type V2LogDetail, v2GetLogContract, v2LogStatusSchema } from '@/lib/api/contracts/v2/logs'
import { loadActiveFolderPathIndex } from '@/lib/folders/queries'
import { materializeExecutionData } from '@/lib/logs/execution/trace-store'
import { getPublicWorkflowLog } from '@/lib/logs/public-queries'
import { withPublicApiRouteHandler } from '@/app/api/public-api-route-handler'
import { resolveWorkspaceAccess } from '@/app/api/v1/middleware'
import { v2Data, v2Error } from '@/app/api/v2/lib/response'

export const revalidate = 0

/**
 * Returns the diagnostic representation of a run. The run ID is the sole
 * public identity; the workflow-execution-log row key remains an internal
 * storage and pagination detail.
 */
export const GET = withPublicApiRouteHandler({
  contract: v2GetLogContract,
  rateLimitEndpoint: 'logs-detail',
  handler: async ({ input, auth: { userId, rateLimit } }) => {
    const { runId } = input.params

    const log = await getPublicWorkflowLog({ column: 'executionId', value: runId })

    if (!log) return v2Error('NOT_FOUND', 'Log not found')

    const access = await resolveWorkspaceAccess(rateLimit, userId, log.workspaceId)
    if (access) return v2Error('NOT_FOUND', 'Log not found')

    const folderIndex = await loadActiveFolderPathIndex(log.workspaceId, 'workflow')
    const executionData = await materializeExecutionData(
      log.executionData as Record<string, unknown> | null,
      { workspaceId: log.workspaceId, workflowId: log.workflowId, executionId: log.executionId }
    )
    if (log.workflowUserId && !log.workflowOwnerEmail) {
      throw new Error(`Unable to resolve workflow owner email for ${log.workflowUserId}`)
    }

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
        folderPath: log.workflowFolderId
          ? (folderIndex.pathById.get(log.workflowFolderId) ?? null)
          : null,
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

    return v2Data(detail, { rateLimit })
  },
})
