import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { getJobQueue } from '@/lib/core/async-jobs'
import { generateRequestId } from '@/lib/core/utils/request'
import { presentDispatchOrJobStatus } from '@/lib/core/workspace-dispatch/status'
import { getDispatchJobRecord } from '@/lib/core/workspace-dispatch/store'
import { createErrorResponse } from '@/app/api/workflows/utils'

const logger = createLogger('TaskStatusAPI')

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId: taskId } = await params
  const requestId = generateRequestId()

  try {
    const authResult = await checkHybridAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized task status request`)
      return createErrorResponse(authResult.error || 'Authentication required', 401)
    }

    const authenticatedUserId = authResult.userId

    const dispatchJob = await getDispatchJobRecord(taskId)
    const jobQueue = await getJobQueue()
    const job = dispatchJob ? null : await jobQueue.getJob(taskId)

    if (!job && !dispatchJob) {
      return createErrorResponse('Task not found', 404)
    }

    const metadataToCheck = dispatchJob?.metadata ?? job?.metadata

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

    const presented = presentDispatchOrJobStatus(dispatchJob, job)
    const response: any = {
      success: true,
      taskId,
      status: presented.status,
      metadata: presented.metadata,
    }

    if (presented.output !== undefined) response.output = presented.output
    if (presented.error !== undefined) response.error = presented.error
    if (presented.estimatedDuration !== undefined) {
      response.estimatedDuration = presented.estimatedDuration
    }

    return NextResponse.json(response)
  } catch (error: any) {
    logger.error(`[${requestId}] Error fetching task status:`, error)

    if (error.message?.includes('not found') || error.status === 404) {
      return createErrorResponse('Task not found', 404)
    }

    return createErrorResponse('Failed to fetch task status', 500)
  }
}
