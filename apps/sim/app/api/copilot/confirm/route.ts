import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  REDIS_TOOL_CALL_PREFIX,
  REDIS_TOOL_CALL_TTL_SECONDS,
  SIM_AGENT_API_URL,
} from '@/lib/copilot/constants'
import {
  authenticateCopilotRequestSessionOnly,
  createBadRequestResponse,
  createInternalServerErrorResponse,
  createRequestTracker,
  createUnauthorizedResponse,
  type NotificationStatus,
} from '@/lib/copilot/request-helpers'
import { env } from '@/lib/core/config/env'
import { getRedisClient } from '@/lib/core/config/redis'

const logger = createLogger('CopilotConfirmAPI')

// Schema for confirmation request
const ConfirmationSchema = z.object({
  toolCallId: z.string().min(1, 'Tool call ID is required'),
  status: z.enum(['success', 'error', 'accepted', 'rejected', 'background'] as const, {
    errorMap: () => ({ message: 'Invalid notification status' }),
  }),
  message: z.string().optional(), // Optional message for background moves or additional context
  toolName: z.string().optional(),
  remember: z.boolean().optional(),
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
    const key = `${REDIS_TOOL_CALL_PREFIX}${toolCallId}`
    const payload = {
      status,
      message: message || null,
      timestamp: new Date().toISOString(),
    }
    await redis.set(key, JSON.stringify(payload), 'EX', REDIS_TOOL_CALL_TTL_SECONDS)
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

async function saveAutoAllowedToolPreference(userId: string, toolName: string): Promise<boolean> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (env.COPILOT_API_KEY) {
    headers['x-api-key'] = env.COPILOT_API_KEY
  }

  try {
    const response = await fetch(`${SIM_AGENT_API_URL}/api/tool-preferences/auto-allowed`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        userId,
        toolId: toolName,
      }),
    })

    if (!response.ok) {
      logger.warn('Failed to persist auto-allowed tool preference', {
        userId,
        toolName,
        status: response.status,
      })
      return false
    }

    return true
  } catch (error) {
    logger.error('Error persisting auto-allowed tool preference', {
      userId,
      toolName,
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
    const { toolCallId, status, message, toolName, remember } = ConfirmationSchema.parse(body)

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

    let rememberSaved = false
    if (status === 'accepted' && remember === true && toolName && authenticatedUserId) {
      rememberSaved = await saveAutoAllowedToolPreference(authenticatedUserId, toolName)
    }

    const response: Record<string, unknown> = {
      success: true,
      message: message || `Tool call ${toolCallId} has been ${status.toLowerCase()}`,
      toolCallId,
      status,
    }
    if (remember === true) {
      response.rememberSaved = rememberSaved
    }

    return NextResponse.json(response)
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
