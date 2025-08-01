import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { getRedisClient } from '@/lib/redis'

const logger = createLogger('CopilotConfirmAPI')

// Tool call status types
type ToolCallStatus = 'Pending' | 'Accepted' | 'Rejected' | 'Error'

// Schema for confirmation request
const ConfirmationSchema = z.object({
  toolCallId: z.string().min(1, 'Tool call ID is required'),
  status: z.enum(['Accept', 'Reject'], {
    errorMap: () => ({ message: 'Status must be either "Accept" or "Reject"' }),
  }),
  message: z.string().optional(), // Optional message for background moves
})

/**
 * Update tool call status in Redis
 */
async function updateToolCallStatus(
  toolCallId: string,
  status: ToolCallStatus,
  message?: string
): Promise<boolean> {
  const redis = getRedisClient()
  if (!redis) {
    logger.warn('updateToolCallStatus: Redis client not available')
    return false
  }

  try {
    const key = `tool_call:${toolCallId}`

    // Check if the key exists first
    const exists = await redis.exists(key)
    if (!exists) {
      logger.warn('Tool call not found in Redis', { toolCallId, key })
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
  const requestId = crypto.randomUUID()
  const startTime = Date.now()

  try {
    // Authenticate user (same pattern as copilot chat)
    const session = await getSession()
    const authenticatedUserId: string | null = session?.user?.id || null

    if (!authenticatedUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { toolCallId, status, message } = ConfirmationSchema.parse(body)

    logger.info(`[${requestId}] Tool call confirmation request`, {
      userId: authenticatedUserId,
      toolCallId,
      status,
      message,
    })

    // Map input status to internal status
    const internalStatus: ToolCallStatus = status === 'Accept' ? 'Accepted' : 'Rejected'

    // Update the tool call status in Redis
    const success = await updateToolCallStatus(toolCallId, internalStatus, message)

    if (!success) {
      logger.error(`[${requestId}] Failed to update tool call status`, {
        userId: authenticatedUserId,
        toolCallId,
        status,
        internalStatus,
        message,
      })
      return NextResponse.json(
        { success: false, error: 'Failed to update tool call status or tool call not found' },
        { status: 400 }
      )
    }

    const duration = Date.now() - startTime
    logger.info(`[${requestId}] Tool call confirmation completed`, {
      userId: authenticatedUserId,
      toolCallId,
      status,
      internalStatus,
      duration,
    })

    return NextResponse.json({
      success: true,
      message: message || `Tool call ${toolCallId} has been ${status.toLowerCase()}ed`,
      toolCallId,
      status: internalStatus,
    })
  } catch (error) {
    const duration = Date.now() - startTime

    if (error instanceof z.ZodError) {
      logger.error(`[${requestId}] Request validation error:`, {
        duration,
        errors: error.errors,
      })
      return NextResponse.json(
        {
          success: false,
          error: `Invalid request data: ${error.errors.map((e) => e.message).join(', ')}`,
        },
        { status: 400 }
      )
    }

    logger.error(`[${requestId}] Unexpected error:`, {
      duration,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    })

    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
