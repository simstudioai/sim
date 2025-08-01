import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createLogger } from '@/lib/logs/console/logger'
import { copilotToolRegistry } from '../tools/registry'
import { createErrorResponse } from './utils'
import { getRedisClient } from '@/lib/redis'

const logger = createLogger('CopilotMethodsAPI')

// Tool call status types
type ToolCallStatus = 'Pending' | 'Accepted' | 'Rejected'

/**
 * Add a tool call to Redis with 'Pending' status
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
    const status: ToolCallStatus = 'Pending'
    
    // Set with 24 hour expiry (86400 seconds)
    await redis.set(key, status, 'EX', 86400)
    
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
async function pollRedisForTool(toolCallId: string): Promise<ToolCallStatus | null> {
  const redis = getRedisClient()
  if (!redis) {
    logger.warn('pollRedisForTool: Redis client not available')
    return null
  }

  const key = `tool_call:${toolCallId}`
  const timeout = 60000 // 60 seconds
  const pollInterval = 1000 // 1 second
  const startTime = Date.now()

  logger.info('Starting to poll Redis for tool call status', {
    toolCallId,
    timeout,
    pollInterval,
  })

  while (Date.now() - startTime < timeout) {
    try {
      const status = await redis.get(key) as ToolCallStatus | null
      
      if (status === 'Accepted' || status === 'Rejected') {
        logger.info('Tool call status resolved', {
          toolCallId,
          status,
          duration: Date.now() - startTime,
        })
        return status
      }

      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, pollInterval))
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
 * Returns true if approved, false if rejected or error
 */
async function interruptHandler(toolCallId: string): Promise<boolean> {
  if (!toolCallId) {
    logger.error('interruptHandler: No tool call ID provided')
    return false
  }

  logger.info('Starting interrupt handler for tool call', { toolCallId })

  try {
    // Step 1: Add tool to Redis with 'Pending' status
    await addToolToRedis(toolCallId)

    // Step 2: Poll Redis for status update
    const status = await pollRedisForTool(toolCallId)

    if (!status) {
      logger.error('Failed to get tool call status or timed out', { toolCallId })
      return false
    }

    if (status === 'Rejected') {
      logger.info('Tool execution rejected by user', { toolCallId })
      return false
    }

    if (status === 'Accepted') {
      logger.info('Tool execution approved by user', { toolCallId })
      return true
    }

    logger.warn('Unexpected tool call status', { toolCallId, status })
    return false
  } catch (error) {
    logger.error('Error in interrupt handler', {
      toolCallId,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return false
  }
}

// Schema for method execution
const MethodExecutionSchema = z.object({
  methodId: z.string().min(1, 'Method ID is required'),
  params: z.record(z.any()).optional().default({}),
  toolCallId: z.string().nullable().optional().default(null),
})

// Simple internal API key authentication
function checkInternalApiKey(req: NextRequest) {
  const apiKey = req.headers.get('x-api-key')
  const expectedApiKey = process.env.INTERNAL_API_SECRET

  if (!expectedApiKey) {
    return { success: false, error: 'Internal API key not configured' }
  }

  if (!apiKey) {
    return { success: false, error: 'API key required' }
  }

  if (apiKey !== expectedApiKey) {
    return { success: false, error: 'Invalid API key' }
  }

  return { success: true }
}

/**
 * POST /api/copilot/methods
 * Execute a method based on methodId with internal API key auth
 */
export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID()
  const startTime = Date.now()

  try {
    // Check authentication (internal API key)
    const authResult = checkInternalApiKey(req)
    if (!authResult.success) {
      return NextResponse.json(createErrorResponse(authResult.error || 'Authentication failed'), {
        status: 401,
      })
    }

    const body = await req.json()
    const { methodId, params, toolCallId } = MethodExecutionSchema.parse(body)

    logger.info(`[${requestId}] Method execution request: ${methodId}`, {
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

      // Handle interrupt flow - returns true if approved, false if rejected/error
      const approved = await interruptHandler(toolCallId)
      
      if (!approved) {
        logger.info(`[${requestId}] Tool execution not approved`, {
          methodId,
          toolCallId,
        })
        return NextResponse.json(
          createErrorResponse('Tool execution was not approved or timed out'),
          { status: 403 }
        )
      }

      logger.info(`[${requestId}] Tool execution approved by user`, {
        methodId,
        toolCallId,
      })
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
