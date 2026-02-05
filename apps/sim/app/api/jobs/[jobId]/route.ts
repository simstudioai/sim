import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { getJobQueue, JOB_STATUS } from '@/lib/core/async-jobs'
import { generateRequestId } from '@/lib/core/utils/request'
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

    const jobQueue = await getJobQueue()
    const job = await jobQueue.getJob(taskId)

    if (!job) {
      return createErrorResponse('Task not found', 404)
    }

    if (job.metadata?.workflowId) {
      const { verifyWorkflowAccess } = await import('@/socket/middleware/permissions')
      const accessCheck = await verifyWorkflowAccess(
        authenticatedUserId,
        job.metadata.workflowId as string
      )
      if (!accessCheck.hasAccess) {
        logger.warn(`[${requestId}] Access denied to workflow ${job.metadata.workflowId}`)
        return createErrorResponse('Access denied', 403)
      }
    } else if (job.metadata?.userId && job.metadata.userId !== authenticatedUserId) {
      logger.warn(`[${requestId}] Access denied to user ${job.metadata.userId}`)
      return createErrorResponse('Access denied', 403)
    } else if (!job.metadata?.userId && !job.metadata?.workflowId) {
      logger.warn(`[${requestId}] Access denied to job ${taskId}`)
      return createErrorResponse('Access denied', 403)
    }

    const mappedStatus = job.status === JOB_STATUS.PENDING ? 'queued' : job.status

    const response: any = {
      success: true,
      taskId,
      status: mappedStatus,
      metadata: {
        startedAt: job.startedAt,
      },
    }

    if (job.status === JOB_STATUS.COMPLETED) {
      response.output = job.output
      response.metadata.completedAt = job.completedAt
      if (job.startedAt && job.completedAt) {
        response.metadata.duration = job.completedAt.getTime() - job.startedAt.getTime()
      }
    }

    if (job.status === JOB_STATUS.FAILED) {
      response.error = job.error
      response.metadata.completedAt = job.completedAt
      if (job.startedAt && job.completedAt) {
        response.metadata.duration = job.completedAt.getTime() - job.startedAt.getTime()
      }
    }

    if (job.status === JOB_STATUS.PROCESSING || job.status === JOB_STATUS.PENDING) {
      response.estimatedDuration = 180000
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
