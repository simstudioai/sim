import { type NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { z } from 'zod'
import { authenticateApiKeyFromHeader, updateApiKeyLastUsed } from '@/lib/api-key/service'
import { getSession } from '@/lib/auth'
import { checkServerSideUsageLimits } from '@/lib/billing'
import { getPersonalAndWorkspaceEnv } from '@/lib/environment/utils'
import { createLogger } from '@/lib/logs/console/logger'
import { LoggingSession } from '@/lib/logs/execution/logging-session'
import { buildTraceSpans } from '@/lib/logs/execution/trace-spans/trace-spans'
import { SSE_HEADERS, generateRequestId, decryptSecret } from '@/lib/utils'
import { loadDeployedWorkflowState, loadWorkflowFromNormalizedTables } from '@/lib/workflows/db-helpers'
import { updateWorkflowRunCounts } from '@/lib/workflows/utils'
import { validateWorkflowAccess } from '@/app/api/workflows/middleware'
import { Executor } from '@/executor'
import type { ExecutionResult, StreamingExecution } from '@/executor/types'
import { Serializer } from '@/serializer'
import { mergeSubblockState } from '@/stores/workflows/server-utils'
import {
  type ExecutionEvent,
  encodeSSEEvent,
} from '@/lib/workflows/execution-events'
import { executeWorkflowCore } from '@/lib/workflows/execution-core'

const EnvVarsSchema = z.record(z.string())

const logger = createLogger('WorkflowExecuteAPI')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

class UsageLimitError extends Error {
  statusCode: number
  constructor(message: string, statusCode = 402) {
    super(message)
    this.statusCode = statusCode
  }
}

/**
 * Execute workflow without SSE - returns JSON response
 * Used by background jobs, webhooks, schedules, and API calls
 */
export async function executeWorkflow(options: {
  requestId: string
  workflowId: string
  userId: string
  workflow: any
  input: any
  triggerType: string
  loggingSession: LoggingSession
  executionId: string
  selectedOutputs?: string[]
}): Promise<NextResponse> {
  try {
    // Use the core execution function
    const result = await executeWorkflowCore(options)

    // Filter out logs and internal metadata for API responses
    const filteredResult = {
      success: result.success,
      output: result.output,
      error: result.error,
      metadata: result.metadata
        ? {
            duration: result.metadata.duration,
            startTime: result.metadata.startTime,
            endTime: result.metadata.endTime,
          }
        : undefined,
    }

    return NextResponse.json(filteredResult)
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Execution failed', success: false },
      { status: 500 }
    )
  }
}

/**
 * POST /api/workflows/[id]/execute
 * 
 * Unified server-side workflow execution endpoint.
 * Supports both SSE streaming (for interactive/manual runs) and direct JSON responses (for background jobs).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = generateRequestId()
  const { id: workflowId } = await params

  try {
    // Authenticate user (API key or session)
    const apiKey = req.headers.get('x-api-key')
    let userId: string

    if (apiKey) {
      const authResult = await authenticateApiKeyFromHeader(apiKey)
      if (!authResult.success || !authResult.userId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      userId = authResult.userId
    } else {
      const session = await getSession()
      if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      userId = session.user.id
    }

    // Validate workflow access (don't require deployment for manual client runs)
    const workflowValidation = await validateWorkflowAccess(req, workflowId, false)
    if (workflowValidation.error) {
      return NextResponse.json(
        { error: workflowValidation.error.message },
        { status: workflowValidation.error.status }
      )
    }
    const workflow = workflowValidation.workflow!

    // Parse request body (handle empty body for curl requests)
    let body: any = {}
    try {
      const text = await req.text()
      if (text) {
        body = JSON.parse(text)
      }
    } catch (error) {
      logger.warn(`[${requestId}] Failed to parse request body, using defaults`)
    }
    
    const {
      input,
      selectedOutputs = [],
      triggerType = 'manual',
      stream: streamParam,
    } = body
    
    // Determine if SSE should be enabled
    // Default: false (JSON response)
    // Client must explicitly request streaming via header or body parameter
    const streamHeader = req.headers.get('X-Stream-Response') === 'true'
    const enableSSE = streamHeader || streamParam === true

    // Check usage limits
    const usageCheck = await checkServerSideUsageLimits(userId)
    if (usageCheck.isExceeded) {
      return NextResponse.json(
        { error: usageCheck.message || 'Usage limit exceeded' },
        { status: 402 }
      )
    }

    // Update API key last used if present
    if (apiKey) {
      await updateApiKeyLastUsed(apiKey)
    }

    logger.info(`[${requestId}] Starting server-side execution`, {
      workflowId,
      userId,
      hasInput: !!input,
      triggerType,
      hasApiKey: !!apiKey,
      streamParam,
      streamHeader,
      enableSSE,
    })

    // Generate execution ID
    const executionId = uuidv4()
    // Map client trigger type to logging trigger type (excluding 'api-endpoint')
    type LoggingTriggerType = 'api' | 'webhook' | 'schedule' | 'manual' | 'chat'
    let loggingTriggerType: LoggingTriggerType = 'manual'
    if (triggerType === 'api' || triggerType === 'chat' || triggerType === 'webhook' || triggerType === 'schedule' || triggerType === 'manual') {
      loggingTriggerType = triggerType as LoggingTriggerType
    }
    const loggingSession = new LoggingSession(workflowId, executionId, loggingTriggerType, requestId)

    // NON-SSE PATH: Direct JSON execution for API calls, background jobs
    if (!enableSSE) {
      logger.info(`[${requestId}] Using non-SSE execution (direct JSON response)`)
      return await executeWorkflow({
        requestId,
        workflowId,
        userId,
        workflow,
        input,
        triggerType,
        loggingSession,
        executionId,
        selectedOutputs,
      })
    }

    // SSE PATH: Stream execution events for client builder UI
    logger.info(`[${requestId}] Using SSE execution (streaming response)`)
    const encoder = new TextEncoder()

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let isStreamClosed = false
        
        const sendEvent = (event: ExecutionEvent) => {
          if (isStreamClosed) return
          
          try {
            logger.info(`[${requestId}] 📤 Sending SSE event:`, {
              type: event.type,
              data: event.data,
            })
            controller.enqueue(encodeSSEEvent(event))
          } catch (error) {
            logger.error(`[${requestId}] Failed to send SSE event:`, error)
          }
        }
        
        try {
          const startTime = new Date()

          // Send execution started event
          sendEvent({
            type: 'execution:started',
            timestamp: startTime.toISOString(),
            executionId,
            workflowId,
            data: {
              startTime: startTime.toISOString(),
            },
          })

          // SSE Callbacks
          const onBlockStart = async (blockId: string, blockName: string, blockType: string) => {
            logger.info(`[${requestId}] 🔷 onBlockStart called:`, { blockId, blockName, blockType })
            sendEvent({
              type: 'block:started',
              timestamp: new Date().toISOString(),
              executionId,
              workflowId,
              data: { blockId, blockName, blockType },
            })
          }
          
          const onBlockComplete = async (blockId: string, blockName: string, blockType: string, callbackData: any) => {
            logger.info(`[${requestId}] ✓ onBlockComplete called:`, { blockId, blockName, blockType })
            sendEvent({
              type: 'block:completed',
              timestamp: new Date().toISOString(),
              executionId,
              workflowId,
              data: {
                blockId,
                blockName,
                blockType,
                output: callbackData.output, // Use clean output without executionTime
                durationMs: callbackData.executionTime || 0,
              },
            })
          }
          
          const onStream = async (streamingExec: StreamingExecution) => {
            const blockId = (streamingExec.execution as any).blockId
            const reader = streamingExec.stream.getReader()
            const decoder = new TextDecoder()
            
            try {
              while (true) {
                const { done, value } = await reader.read()
                if (done) break
                
                const chunk = decoder.decode(value, { stream: true })
                sendEvent({
                  type: 'stream:chunk',
                  timestamp: new Date().toISOString(),
                  executionId,
                  workflowId,
                  data: { blockId, chunk },
                })
              }
              
              sendEvent({
                type: 'stream:done',
                timestamp: new Date().toISOString(),
                executionId,
                workflowId,
                data: { blockId },
              })
            } catch (error) {
              logger.error(`[${requestId}] Error streaming block content:`, error)
            } finally {
              try {
                reader.releaseLock()
              } catch {}
            }
          }

          // Execute using core function with SSE callbacks
          const result = await executeWorkflowCore({
            requestId,
            workflowId,
            userId,
            workflow,
            input,
            triggerType,
            loggingSession,
            executionId,
            selectedOutputs,
            onBlockStart,
            onBlockComplete,
            onStream,
          })

          // Check if execution was cancelled
          if (result.error === 'Workflow execution was cancelled') {
            logger.info(`[${requestId}] Workflow execution was cancelled`)
            sendEvent({
              type: 'execution:cancelled',
              timestamp: new Date().toISOString(),
              executionId,
              workflowId,
              data: {
                duration: result.metadata?.duration || 0,
              },
            })
            return // Exit early
          }

          // Send execution completed event
          sendEvent({
            type: 'execution:completed',
            timestamp: new Date().toISOString(),
            executionId,
            workflowId,
            data: {
              success: result.success,
              output: result.output,
              duration: result.metadata?.duration || 0,
              startTime: result.metadata?.startTime || startTime.toISOString(),
              endTime: result.metadata?.endTime || new Date().toISOString(),
            },
          })

        } catch (error: any) {
          logger.error(`[${requestId}] SSE execution failed:`, error)
          
          // Send error event
          sendEvent({
            type: 'execution:error',
            timestamp: new Date().toISOString(),
            executionId,
            workflowId,
            data: {
              error: error.message || 'Unknown error',
              duration: 0,
            },
          })
        } finally {
          // Close the stream
          try {
            // Send final [DONE] marker
            controller.enqueue(encoder.encode('data: [DONE]\n\n'))
            controller.close()
          } catch (error) {
            logger.error(`[${requestId}] Error closing stream:`, error)
          }
        }
      },
      cancel() {
        logger.info(`[${requestId}] Client aborted SSE stream`)
        // Note: Stream is automatically closed by browser
        // The core function will complete but won't send more events
      },
    })

    // Return SSE response
    return new NextResponse(stream, {
      headers: {
        ...SSE_HEADERS,
        'X-Execution-Id': executionId,
      },
    })

  } catch (error: any) {
    logger.error(`[${requestId}] Failed to start workflow execution:`, error)
    return NextResponse.json(
      { error: error.message || 'Failed to start workflow execution' },
      { status: 500 }
    )
  }
}

