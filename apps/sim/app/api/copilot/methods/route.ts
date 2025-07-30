import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createLogger } from '@/lib/logs/console/logger'
import { copilotToolRegistry } from '../tools/registry'
import { createErrorResponse } from './utils'

const logger = createLogger('CopilotMethodsAPI')

// Schema for method execution
const MethodExecutionSchema = z.object({
  methodId: z.string().min(1, 'Method ID is required'),
  params: z.record(z.any()).optional().default({}),
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
    const { methodId, params } = MethodExecutionSchema.parse(body)

    logger.info(`[${requestId}] Method execution request: ${methodId}`, {
      methodId,
      hasParams: !!params && Object.keys(params).length > 0,
    })

    // Check if tool exists in registry
    if (!copilotToolRegistry.has(methodId)) {
      logger.error(`[${requestId}] Tool not found in registry: ${methodId}`, {
        methodId,
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

    logger.info(`[${requestId}] Tool found in registry: ${methodId}`)

    // Execute the tool directly via registry
    const result = await copilotToolRegistry.execute(methodId, params)

    logger.info(`[${requestId}] Tool execution result:`, {
      methodId,
      success: result.success,
      hasData: !!result.data,
      hasError: !!result.error,
    })

    const duration = Date.now() - startTime
    logger.info(`[${requestId}] Method execution completed: ${methodId}`, {
      methodId,
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
