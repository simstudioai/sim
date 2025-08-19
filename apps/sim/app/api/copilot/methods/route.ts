import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { copilotToolRegistry } from '@/lib/copilot/tools/server-tools/registry'
import type { NotificationStatus } from '@/lib/copilot/types'
import { checkCopilotApiKey, checkInternalApiKey } from '@/lib/copilot/utils'
import { createLogger } from '@/lib/logs/console/logger'
import { getRedisClient } from '@/lib/redis'
import { createErrorResponse } from '@/app/api/copilot/methods/utils'

const logger = createLogger('CopilotMethodsAPI')

/**
 * Add a tool call to Redis with 'pending' status
 */
async function addToolToRedis(toolCallId: string): Promise<void> {
  if (!toolCallId) {
    logger.warn('addToolToRedis: No tool call ID provided')
    return
  }

  const redis = getRedisClient()
  if (!redis) {
    logger.warn('addToolToRedis: Redis client not available')
    return
  }

  try {
    const key = `tool_call:${toolCallId}`
    const status: NotificationStatus = 'pending'

    // Store as JSON object for consistency with confirm API
    const toolCallData = {
      status,
      message: null,
      timestamp: new Date().toISOString(),
    }

    // Set with 24 hour expiry (86400 seconds)
    await redis.set(key, JSON.stringify(toolCallData), 'EX', 86400)

    logger.info('Tool call added to Redis', {
      toolCallId,
      key,
      status,
    })
  } catch (error) {
    logger.error('Failed to add tool call to Redis', {
      toolCallId,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}

/**
 * Poll Redis for tool call status updates
 * Returns when status changes to 'Accepted' or 'Rejected', or times out after 60 seconds
 */
async function pollRedisForTool(
  toolCallId: string
): Promise<{ status: NotificationStatus; message?: string; fullData?: any } | null> {
  const redis = getRedisClient()
  if (!redis) {
    logger.warn('pollRedisForTool: Redis client not available')
    return null
  }

  const key = `tool_call:${toolCallId}`
  const timeout = 600000 // 10 minutes for long-running operations
  const pollInterval = 1000 // 1 second
  const startTime = Date.now()

  while (Date.now() - startTime < timeout) {
    try {
      const redisValue = await redis.get(key)
      if (!redisValue) {
        // Wait before next poll
        await new Promise((resolve) => setTimeout(resolve, pollInterval))
        continue
      }

      let status: NotificationStatus | null = null
      let message: string | undefined
      let fullData: any = null

      // Try to parse as JSON (new format), fallback to string (old format)
      try {
        const parsedData = JSON.parse(redisValue)
        status = parsedData.status as NotificationStatus
        message = parsedData.message || undefined
        fullData = parsedData // Store the full parsed data
      } catch {
        // Fallback to old format (direct status string)
        status = redisValue as NotificationStatus
      }

      if (status !== 'pending') {
        // Log the message found in redis prominently - always log, even if message is null/undefined
        logger.info('Redis poller found non-pending status', {
          toolCallId,
          foundMessage: message,
          messageType: typeof message,
          messageIsNull: message === null,
          messageIsUndefined: message === undefined,
          status,
          duration: Date.now() - startTime,
          rawRedisValue: redisValue,
        })

        // Special logging for set environment variables tool when Redis status is found
        if (toolCallId && (status === 'accepted' || status === 'rejected')) {
          logger.info('SET_ENV_VARS: Redis polling found status update', {
            toolCallId,
            foundStatus: status,
            redisMessage: message,
            pollDuration: Date.now() - startTime,
            redisKey: `tool_call:${toolCallId}`,
          })
        }

        return { status, message, fullData }
      }

      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, pollInterval))
    } catch (error) {
      logger.error('Error polling Redis for tool call status', {
        toolCallId,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
      return null
    }
  }

  logger.warn('Tool call polling timed out', {
    toolCallId,
    timeout,
  })
  return null
}

/**
 * Handle tool calls that require user interruption/approval
 * Returns { approved: boolean, rejected: boolean, error?: boolean, message?: string } to distinguish between rejection, timeout, and error
 */
async function interruptHandler(toolCallId: string): Promise<{
  approved: boolean
  rejected: boolean
  error?: boolean
  message?: string
  fullData?: any
}> {
  if (!toolCallId) {
    logger.error('interruptHandler: No tool call ID provided')
    return { approved: false, rejected: false, error: true, message: 'No tool call ID provided' }
  }

  logger.info('Starting interrupt handler for tool call', { toolCallId })

  try {
    // Step 1: Add tool to Redis with 'pending' status
    await addToolToRedis(toolCallId)

    // Step 2: Poll Redis for status update
    const result = await pollRedisForTool(toolCallId)

    if (!result) {
      logger.error('Failed to get tool call status or timed out', { toolCallId })
      return { approved: false, rejected: false }
    }

    const { status, message, fullData } = result

    if (status === 'rejected') {
      logger.info('Tool execution rejected by user', { toolCallId, message })
      return { approved: false, rejected: true, message, fullData }
    }

    if (status === 'accepted') {
      logger.info('Tool execution approved by user', { toolCallId, message })
      return { approved: true, rejected: false, message, fullData }
    }

    if (status === 'error') {
      logger.error('Tool execution failed with error', { toolCallId, message })
      return { approved: false, rejected: false, error: true, message, fullData }
    }

    if (status === 'background') {
      logger.info('Tool execution moved to background', { toolCallId, message })
      return { approved: true, rejected: false, message, fullData }
    }

    if (status === 'success') {
      logger.info('Tool execution completed successfully', { toolCallId, message })
      return { approved: true, rejected: false, message, fullData }
    }

    logger.warn('Unexpected tool call status', { toolCallId, status, message })
    return {
      approved: false,
      rejected: false,
      error: true,
      message: `Unexpected tool call status: ${status}`,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    logger.error('Error in interrupt handler', {
      toolCallId,
      error: errorMessage,
    })
    return {
      approved: false,
      rejected: false,
      error: true,
      message: `Interrupt handler error: ${errorMessage}`,
    }
  }
}

const MethodExecutionSchema = z.object({
  methodId: z.string().min(1, 'Method ID is required'),
  params: z.record(z.any()).optional().default({}),
  toolCallId: z.string().nullable().optional().default(null),
})

/**
 * POST /api/copilot/methods
 * Execute a method based on methodId with internal API key auth
 */
export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID()
  const startTime = Date.now()

  try {
    // Evaluate both auth schemes; pass if either is valid
    const internalAuth = checkInternalApiKey(req)
    const copilotAuth = checkCopilotApiKey(req)
    const isAuthenticated = !!(internalAuth?.success || copilotAuth?.success)
    if (!isAuthenticated) {
      const errorMessage = copilotAuth.error || internalAuth.error || 'Authentication failed'
      return NextResponse.json(createErrorResponse(errorMessage), {
        status: 401,
      })
    }

    const body = await req.json()
    const { methodId, params, toolCallId } = MethodExecutionSchema.parse(body)

    logger.info(`[${requestId}] Method execution request`, {
      methodId,
      toolCallId,
      hasParams: !!params && Object.keys(params).length > 0,
    })

    // Check if tool exists in registry
    if (!copilotToolRegistry.has(methodId)) {
      logger.error(`[${requestId}] Tool not found in registry: ${methodId}`, {
        methodId,
        toolCallId,
        availableTools: copilotToolRegistry.getAvailableIds(),
        registrySize: copilotToolRegistry.getAvailableIds().length,
      })
      return NextResponse.json(
        createErrorResponse(
          `Unknown method: ${methodId}. Available methods: ${copilotToolRegistry.getAvailableIds().join(', ')}`
        ),
        { status: 400 }
      )
    }

    logger.info(`[${requestId}] Tool found in registry: ${methodId}`, {
      toolCallId,
    })

    // Check if the tool requires interrupt/approval
    const tool = copilotToolRegistry.get(methodId)
    if (tool?.requiresInterrupt) {
      if (!toolCallId) {
        logger.warn(`[${requestId}] Tool requires interrupt but no toolCallId provided`, {
          methodId,
        })
        return NextResponse.json(
          createErrorResponse('This tool requires approval but no tool call ID was provided'),
          { status: 400 }
        )
      }

      logger.info(`[${requestId}] Tool requires interrupt, starting approval process`, {
        methodId,
        toolCallId,
      })

      // Handle interrupt flow
      const { approved, rejected, error, message, fullData } = await interruptHandler(toolCallId)

      if (rejected) {
        logger.info(`[${requestId}] Tool execution rejected by user`, {
          methodId,
          toolCallId,
          message,
        })
        return NextResponse.json(
          createErrorResponse(
            'The user decided to skip running this tool. This was a user decision.'
          ),
          { status: 200 } // Changed to 200 - user rejection is a valid response
        )
      }

      if (error) {
        logger.error(`[${requestId}] Tool execution failed with error`, {
          methodId,
          toolCallId,
          message,
        })
        return NextResponse.json(
          createErrorResponse(message || 'Tool execution failed with unknown error'),
          { status: 500 } // 500 Internal Server Error
        )
      }

      if (!approved) {
        logger.warn(`[${requestId}] Tool execution timed out`, {
          methodId,
          toolCallId,
        })
        return NextResponse.json(
          createErrorResponse('Tool execution request timed out'),
          { status: 408 } // 408 Request Timeout
        )
      }

      logger.info(`[${requestId}] Tool execution approved by user`, {
        methodId,
        toolCallId,
        message,
      })

      // For tools that need confirmation data, pass the message and/or fullData as parameters
      if (message) {
        params.confirmationMessage = message
      }
      if (fullData) {
        params.fullData = fullData
      }
    }

    // Execute the tool directly via registry
    const result = await copilotToolRegistry.execute(methodId, params)

    logger.info(`[${requestId}] Tool execution result:`, {
      methodId,
      toolCallId,
      success: result.success,
      hasData: !!result.data,
      hasError: !!result.error,
    })

    const duration = Date.now() - startTime
    logger.info(`[${requestId}] Method execution completed: ${methodId}`, {
      methodId,
      toolCallId,
      duration,
      success: result.success,
    })

    return NextResponse.json(result)
  } catch (error) {
    const duration = Date.now() - startTime

    if (error instanceof z.ZodError) {
      logger.error(`[${requestId}] Request validation error:`, {
        duration,
        errors: error.errors,
      })
      return NextResponse.json(
        createErrorResponse(
          `Invalid request data: ${error.errors.map((e) => e.message).join(', ')}`
        ),
        { status: 400 }
      )
    }

    logger.error(`[${requestId}] Unexpected error:`, {
      duration,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    })

    return NextResponse.json(
      createErrorResponse(error instanceof Error ? error.message : 'Internal server error'),
      { status: 500 }
    )
  }
}
