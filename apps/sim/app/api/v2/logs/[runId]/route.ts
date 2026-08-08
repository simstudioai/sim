import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import type { NextRequest } from 'next/server'
import { traceSpansSchema } from '@/lib/api/contracts/logs'
import { type V2LogDetail, v2GetLogContract, v2LogStatusSchema } from '@/lib/api/contracts/v2/logs'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { loadActiveFolderPathIndex } from '@/lib/folders/queries'
import { materializeExecutionData } from '@/lib/logs/execution/trace-store'
import { getPublicWorkflowLog } from '@/lib/logs/public-queries'
import { checkRateLimit, resolveWorkspaceAccess } from '@/app/api/v1/middleware'
import { v2ApiGateError } from '@/app/api/v2/lib/gate'
import { v2Data, v2Error, v2RateLimitError, v2ValidationError } from '@/app/api/v2/lib/response'

const logger = createLogger('V2LogDetailAPI')

export const revalidate = 0

/**
 * Returns the diagnostic representation of a run. The run ID is the sole
 * public identity; the workflow-execution-log row key remains an internal
 * storage and pagination detail.
 */
export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ runId: string }> }) => {
    const requestId = generateId().slice(0, 8)

    try {
      const rateLimit = await checkRateLimit(request, 'logs-detail')
      if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

      const userId = rateLimit.userId!

      const gate = await v2ApiGateError(userId)
      if (gate) return gate

      const parsed = await parseRequest(v2GetLogContract, request, context, {
        validationErrorResponse: v2ValidationError,
      })
      if (!parsed.success) return parsed.response

      const { runId } = parsed.data.params

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
    } catch (error) {
      logger.error(`[${requestId}] Log detail fetch error`, {
        error: getErrorMessage(error, 'Unknown error'),
      })
      return v2Error('INTERNAL_ERROR', 'Internal server error')
    }
  }
)
