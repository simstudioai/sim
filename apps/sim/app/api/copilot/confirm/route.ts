import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  authenticateCopilotRequestSessionOnly,
  createBadRequestResponse,
  createInternalServerErrorResponse,
  createRequestTracker,
  createUnauthorizedResponse,
  type NotificationStatus,
} from '@/lib/copilot/request-helpers'
import { getRedisClient } from '@/lib/core/config/redis'

const logger = createLogger('CopilotConfirmAPI')

// Schema for confirmation request
const ConfirmationSchema = z.object({
  toolCallId: z.string().min(1, 'Tool call ID is required'),
  status: z.enum(['success', 'error', 'accepted', 'rejected', 'background'] as const, {
    errorMap: () => ({ message: 'Invalid notification status' }),
  }),
  message: z.string().optional(), // Optional message for background moves or additional context
})

/**
 * Write the user's tool decision to Redis. The server-side orchestrator's
 * waitForToolDecision() polls Redis for this value.
 */
async function updateToolCallStatus(
  toolCallId: string,
  status: NotificationStatus,
  message?: string
): Promise<boolean> {
  const redis = getRedisClient()
  if (!redis) {
    logger.warn('Redis client not available for tool confirmation')
    return false
  }

  try {
    const key = `tool_call:${toolCallId}`
    const payload = {
      status,
      message: message || null,
      timestamp: new Date().toISOString(),
    }
    await redis.set(key, JSON.stringify(payload), 'EX', 86400)
    return true
  } catch (error) {
    logger.error('Failed to update tool call status', {
      toolCallId,
      status,
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}

/**
 * POST /api/copilot/confirm
 * Update tool call status (Accept/Reject)
 */
export async function POST(req: NextRequest) {
  const tracker = createRequestTracker()

  try {
    // Authenticate user using consolidated helper
    const { userId: authenticatedUserId, isAuthenticated } =
      await authenticateCopilotRequestSessionOnly()

    if (!isAuthenticated) {
      return createUnauthorizedResponse()
    }

    const body = await req.json()
    const { toolCallId, status, message } = ConfirmationSchema.parse(body)

    // Update the tool call status in Redis
    const updated = await updateToolCallStatus(toolCallId, status, message)

    if (!updated) {
      logger.error(`[${tracker.requestId}] Failed to update tool call status`, {
        userId: authenticatedUserId,
        toolCallId,
        status,
        internalStatus: status,
        message,
      })
      return createBadRequestResponse('Failed to update tool call status or tool call not found')
    }

    const duration = tracker.getDuration()

    return NextResponse.json({
      success: true,
      message: message || `Tool call ${toolCallId} has been ${status.toLowerCase()}`,
      toolCallId,
      status,
    })
  } catch (error) {
    const duration = tracker.getDuration()

    if (error instanceof z.ZodError) {
      logger.error(`[${tracker.requestId}] Request validation error:`, {
        duration,
        errors: error.errors,
      })
      return createBadRequestResponse(
        `Invalid request data: ${error.errors.map((e) => e.message).join(', ')}`
      )
    }

    logger.error(`[${tracker.requestId}] Unexpected error:`, {
      duration,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    })

    return createInternalServerErrorResponse(
      error instanceof Error ? error.message : 'Internal server error'
    )
  }
}
