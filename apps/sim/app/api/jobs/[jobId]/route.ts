import { createLogger } from '@sim/logger'
import { runs } from '@trigger.dev/sdk'
import { type NextRequest, NextResponse } from 'next/server'
import { checkHybridAuth } from '@/lib/auth/hybrid'
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
    logger.debug(`[${requestId}] Getting status for task: ${taskId}`)

    const authResult = await checkHybridAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized task status request`)
      return createErrorResponse(authResult.error || 'Authentication required', 401)
    }

    const authenticatedUserId = authResult.userId

    const run = await runs.retrieve(taskId)

    logger.debug(`[${requestId}] Task ${taskId} status: ${run.status}`)

    const payload = run.payload as any
    if (payload?.workflowId) {
      const { verifyWorkflowAccess } = await import('@/socket/middleware/permissions')
      const accessCheck = await verifyWorkflowAccess(authenticatedUserId, payload.workflowId)
      if (!accessCheck.hasAccess) {
        logger.warn(`[${requestId}] User ${authenticatedUserId} denied access to task ${taskId}`, {
          workflowId: payload.workflowId,
        })
        return createErrorResponse('Access denied', 403)
      }
      logger.debug(`[${requestId}] User ${authenticatedUserId} has access to task ${taskId}`)
    } else {
      if (payload?.userId && payload.userId !== authenticatedUserId) {
        logger.warn(
          `[${requestId}] User ${authenticatedUserId} attempted to access task ${taskId} owned by ${payload.userId}`
        )
        return createErrorResponse('Access denied', 403)
      }
      if (!payload?.userId) {
        logger.warn(
          `[${requestId}] Task ${taskId} has no ownership information in payload. Denying access for security.`
        )
        return createErrorResponse('Access denied', 403)
      }
    }

    const statusMap = {
      QUEUED: 'queued',
      WAITING_FOR_DEPLOY: 'queued',
      EXECUTING: 'processing',
      RESCHEDULED: 'processing',
      FROZEN: 'processing',
      COMPLETED: 'completed',
      CANCELED: 'cancelled',
      FAILED: 'failed',
      CRASHED: 'failed',
      INTERRUPTED: 'failed',
      SYSTEM_FAILURE: 'failed',
      EXPIRED: 'failed',
    } as const

    const mappedStatus = statusMap[run.status as keyof typeof statusMap] || 'unknown'

    const response: any = {
      success: true,
      taskId,
      status: mappedStatus,
      metadata: {
        startedAt: run.startedAt,
      },
    }

    if (mappedStatus === 'completed') {
      response.output = run.output // This contains the workflow execution results
      response.metadata.completedAt = run.finishedAt
      response.metadata.duration = run.durationMs
    }

    if (mappedStatus === 'failed') {
      response.error = run.error
      response.metadata.completedAt = run.finishedAt
      response.metadata.duration = run.durationMs
    }

    if (mappedStatus === 'processing' || mappedStatus === 'queued') {
      response.estimatedDuration = 180000 // 3 minutes max from our config
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
