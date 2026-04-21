import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { getJobQueue } from '@/lib/core/async-jobs'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createErrorResponse } from '@/app/api/workflows/utils'

const logger = createLogger('TaskStatusAPI')

export const GET = withRouteHandler(
  async (request: NextRequest, { params }: { params: Promise<{ jobId: string }> }) => {
    const { jobId: taskId } = await params
    const requestId = generateRequestId()

    try {
      const authResult = await checkHybridAuth(request, { requireWorkflowId: false })
      if (!authResult.success || !authResult.userId) {
        logger.warn(`[${requestId}] Unauthorized task status request`)
        return createErrorResponse(authResult.error || 'Authentication required', 401)
      }

      const authenticatedUserId = authResult.userId

      const jobQueue = await getJobQueue()
      const job = await jobQueue.getJob(taskId)

      if (!job) {
        return createErrorResponse('Task not found', 404)
      }

      const metadataToCheck = job.metadata

      if (metadataToCheck?.workflowId) {
        const { verifyWorkflowAccess } = await import('@/socket/middleware/permissions')
        const accessCheck = await verifyWorkflowAccess(
          authenticatedUserId,
          metadataToCheck.workflowId as string
        )
        if (!accessCheck.hasAccess) {
          logger.warn(`[${requestId}] Access denied to workflow ${metadataToCheck.workflowId}`)
          return createErrorResponse('Access denied', 403)
        }

        if (authResult.apiKeyType === 'workspace' && authResult.workspaceId) {
          const { getWorkflowById } = await import('@/lib/workflows/utils')
          const workflow = await getWorkflowById(metadataToCheck.workflowId as string)
          if (!workflow?.workspaceId || workflow.workspaceId !== authResult.workspaceId) {
            return createErrorResponse('API key is not authorized for this workspace', 403)
          }
        }
      } else if (metadataToCheck?.userId && metadataToCheck.userId !== authenticatedUserId) {
        logger.warn(`[${requestId}] Access denied to user ${metadataToCheck.userId}`)
        return createErrorResponse('Access denied', 403)
      } else if (!metadataToCheck?.userId && !metadataToCheck?.workflowId) {
        logger.warn(`[${requestId}] Access denied to job ${taskId}`)
        return createErrorResponse('Access denied', 403)
      }

      const response: Record<string, unknown> = {
        success: true,
        taskId,
        status: job.status,
        metadata: job.metadata,
      }

      if (job.output !== undefined) response.output = job.output
      if (job.error !== undefined) response.error = job.error

      return NextResponse.json(response)
    } catch (error: unknown) {
      const errorMessage = toError(error).message
      logger.error(`[${requestId}] Error fetching task status:`, error)

      if (errorMessage?.includes('not found')) {
        return createErrorResponse('Task not found', 404)
      }

      return createErrorResponse('Failed to fetch task status', 500)
    }
  }
)
