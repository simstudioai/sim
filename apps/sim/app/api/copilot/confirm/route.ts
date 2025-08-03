import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  authenticateCopilotRequestSessionOnly,
  createBadRequestResponse,
  createInternalServerErrorResponse,
  createRequestTracker,
  createUnauthorizedResponse,
  type NotificationStatus,
} from '@/lib/copilot/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { getRedisClient } from '@/lib/redis'

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
 * Update tool call status in Redis
 */
async function updateToolCallStatus(
  toolCallId: string,
  status: NotificationStatus,
  message?: string
): Promise<boolean> {
  const redis = getRedisClient()
  if (!redis) {
    logger.warn('updateToolCallStatus: Redis client not available')
    return false
  }

  try {
    const key = `tool_call:${toolCallId}`
    const timeout = 60000 // 1 minute timeout
    const pollInterval = 100 // Poll every 100ms
    const startTime = Date.now()

    logger.info('Polling for tool call in Redis', { toolCallId, key, timeout })

    // Poll until the key exists or timeout
    while (Date.now() - startTime < timeout) {
      const exists = await redis.exists(key)
      if (exists) {
        logger.info('Tool call found in Redis, updating status', {
          toolCallId,
          key,
          pollDuration: Date.now() - startTime,
        })
        break
      }

      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, pollInterval))
    }

    // Final check if key exists after polling
    const exists = await redis.exists(key)
    if (!exists) {
      logger.warn('Tool call not found in Redis after polling timeout', {
        toolCallId,
        key,
        timeout,
        pollDuration: Date.now() - startTime,
      })
      return false
    }

    // Store both status and message as JSON
    const toolCallData = {
      status,
      message: message || null,
      timestamp: new Date().toISOString(),
    }
    await redis.set(key, JSON.stringify(toolCallData), 'EX', 86400) // Keep 24 hour expiry

    logger.info('Tool call status updated in Redis', {
      toolCallId,
      key,
      status,
      message,
      pollDuration: Date.now() - startTime,
    })
    return true
  } catch (error) {
    logger.error('Failed to update tool call status in Redis', {
      toolCallId,
      status,
      message,
      error: error instanceof Error ? error.message : 'Unknown error',
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

    logger.info(`[${tracker.requestId}] Tool call confirmation request`, {
      userId: authenticatedUserId,
      toolCallId,
      status,
      message,
    })

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
    logger.info(`[${tracker.requestId}] Tool call confirmation completed`, {
      userId: authenticatedUserId,
      toolCallId,
      status,
      internalStatus: status,
      duration,
    })

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
