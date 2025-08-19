import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateCopilotRequestSessionOnly } from '@/lib/copilot/auth'
import { copilotToolRegistry } from '@/lib/copilot/tools/server-tools/registry'
import { checkCopilotApiKey, checkInternalApiKey } from '@/lib/copilot/utils'
import { createLogger } from '@/lib/logs/console/logger'
import { simAgentClient } from '@/lib/sim-agent'
import { createErrorResponse } from '@/app/api/copilot/methods/utils'

const logger = createLogger('CopilotMethodsAPI')

// MethodId for /api/complete-tool payload
export type MethodId = string

// Payload type for sim-agent completion callback
interface CompleteToolRequestBody {
  toolId: string
  methodId: MethodId
  success: boolean
  data?: unknown
  error?: string
}

const MethodExecutionSchema = z.object({
  methodId: z.string().min(1, 'Method ID is required'),
  params: z.record(z.any()).optional().default({}),
  toolCallId: z.string().nullable().optional().default(null),
  toolId: z.string().nullable().optional().default(null),
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
    const sessionAuth = await authenticateCopilotRequestSessionOnly()
    const isAuthenticated = !!(
      internalAuth?.success ||
      copilotAuth?.success ||
      sessionAuth.isAuthenticated
    )
    if (!isAuthenticated) {
      const errorMessage = copilotAuth.error || internalAuth.error || 'Authentication failed'
      return NextResponse.json(createErrorResponse(errorMessage), {
        status: 401,
      })
    }

    const body = await req.json()
    const { methodId, params, toolCallId, toolId } = MethodExecutionSchema.parse(body)

    if (methodId === 'get_user_workflow') {
      const confirmationMessage = (params as any)?.confirmationMessage
      const fullData = (params as any)?.fullData
      logger.info(`[${requestId}] [NEW_FLOW] get_user_workflow payload received`, {
        methodId,
        toolId,
        toolCallId,
        fromSessionAuth: sessionAuth.isAuthenticated,
        hasConfirmationMessage: typeof confirmationMessage === 'string',
        confirmationMessageLength:
          typeof confirmationMessage === 'string' ? confirmationMessage.length : null,
        hasFullData: !!fullData,
        fullDataKeys: fullData ? Object.keys(fullData) : [],
        fullDataUserWorkflowLength:
          fullData && typeof fullData.userWorkflow === 'string'
            ? fullData.userWorkflow.length
            : null,
      })
    }

    if (methodId === 'get_blocks_metadata') {
      const blockIds = (params as any)?.blockIds
      logger.info(`[${requestId}] [NEW_FLOW] get_blocks_metadata payload received`, {
        methodId,
        toolId,
        toolCallId,
        hasBlockIds: Array.isArray(blockIds),
        blockIdsType:
          blockIds === undefined
            ? 'undefined'
            : Array.isArray(blockIds)
              ? 'array'
              : typeof blockIds,
        blockIdsCount: Array.isArray(blockIds) ? blockIds.length : null,
        blockIdsPreview: Array.isArray(blockIds) ? blockIds.slice(0, 10) : undefined,
        paramsRawKeys: Object.keys((params as any) || {}),
        paramsRawPreview: (() => {
          try {
            return JSON.stringify(params).substring(0, 200)
          } catch {
            return 'unserializable'
          }
        })(),
      })
    }

    logger.info(`[${requestId}] Method execution request`, {
      methodId,
      toolCallId,
      toolId,
      hasParams: !!params && Object.keys(params).length > 0,
    })

    // Auto-inject session userId for selected methods if missing
    if (
      (methodId === 'get_oauth_credentials' ||
        methodId === 'list_gdrive_files' ||
        methodId === 'read_gdrive_file') &&
      (!params || typeof (params as any).userId !== 'string' || !(params as any).userId)
    ) {
      if (sessionAuth.userId) {
        ;(params as any).userId = sessionAuth.userId
        logger.info(`[${requestId}] Injected session userId into params`, {
          methodId,
          injectedUserId: sessionAuth.userId,
        })
      } else {
        logger.warn(`[${requestId}] No session userId available to inject`, { methodId })
      }
    }

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
          `Unknown method: ${methodId}. Available methods: ${copilotToolRegistry
            .getAvailableIds()
            .join(', ')}`
        ),
        { status: 400 }
      )
    }

    logger.info(`[${requestId}] Tool found in registry: ${methodId}`, {
      toolCallId,
      toolId,
    })

    // Execute the tool directly via registry (no interrupts/redis)
    const result = await copilotToolRegistry.execute(methodId, params)

    let dataLength: number | null = null
    try {
      if (typeof result?.data === 'string') dataLength = result.data.length
      else if (result?.data !== undefined) dataLength = JSON.stringify(result.data).length
    } catch {}

    logger.info(`[${requestId}] Tool execution result:`, {
      methodId,
      toolCallId,
      toolId,
      success: result.success,
      hasData: !!result.data,
      dataLength,
      hasError: !!result.error,
    })

    // Send completion callback to sim-agent for all methods, on both success and failure
    {
      const completionPayload: CompleteToolRequestBody = {
        toolId: (toolId || toolCallId || requestId) as string,
        methodId: methodId === 'run_workflow' ? 'no_op' : (methodId as MethodId),
        success: !!result.success,
        ...(result.success
          ? { data: result.data as unknown }
          : { error: (result as any)?.error || 'Unknown error' }),
      }

      let completionDataLength: number | null = null
      try {
        if (completionPayload.data !== undefined) {
          completionDataLength =
            typeof completionPayload.data === 'string'
              ? (completionPayload.data as string).length
              : JSON.stringify(completionPayload.data).length
        }
      } catch {}

      logger.info(`[${requestId}] Sending completion payload to sim-agent`, {
        endpoint: '/api/complete-tool',
        methodId: completionPayload.methodId,
        toolId: completionPayload.toolId,
        success: completionPayload.success,
        hasData: !!completionPayload.data,
        hasError: !!completionPayload.error,
        dataLength: completionDataLength,
      })

      try {
        const resp = await simAgentClient.makeRequest('/api/complete-tool', {
          method: 'POST',
          body: completionPayload as any,
        })
        logger.info(`[${requestId}] Sim-agent completion response`, {
          success: resp.success,
          status: resp.status,
        })
      } catch (callbackError) {
        logger.error(`[${requestId}] Failed to send completion payload to sim-agent`, {
          error: callbackError instanceof Error ? callbackError.message : 'Unknown error',
        })
      }
    }

    const duration = Date.now() - startTime
    logger.info(`[${requestId}] Method execution completed: ${methodId}`, {
      methodId,
      toolCallId,
      toolId,
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
