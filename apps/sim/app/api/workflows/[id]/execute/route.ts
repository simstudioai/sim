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
import { decryptSecret, SSE_HEADERS, generateRequestId } from '@/lib/utils'
import { loadDeployedWorkflowState, loadWorkflowFromNormalizedTables } from '@/lib/workflows/db-helpers'
import { updateWorkflowRunCounts } from '@/lib/workflows/utils'
import { validateWorkflowAccess } from '@/app/api/workflows/middleware'
import { Executor } from '@/executor'
import type { ExecutionResult, StreamingExecution, BlockLog } from '@/executor/types'
import { Serializer } from '@/serializer'
import { mergeSubblockState } from '@/stores/workflows/server-utils'
import type { TriggerType } from '@/services/queue'
import {
  type ExecutionEvent,
  encodeSSEEvent,
} from '@/lib/workflows/execution-events'

const logger = createLogger('WorkflowExecuteAPI')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const EnvVarsSchema = z.record(z.string())

class UsageLimitError extends Error {
  statusCode: number
  constructor(message: string, statusCode = 402) {
    super(message)
    this.statusCode = statusCode
  }
}

/**
 * Execute workflow directly without SSE (for background jobs, webhooks, schedules)
 * Exported for use by background jobs
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
  const { requestId, workflowId, userId, workflow, input, triggerType, loggingSession, executionId, selectedOutputs } = options
  
  let processedInput = input || {}
  
  try {
    const startTime = new Date()

    // Load workflow state based on trigger type
    let blocks, edges, loops, parallels
    
    if (triggerType === 'manual') {
      const draftData = await loadWorkflowFromNormalizedTables(workflowId)
      if (!draftData) {
        throw new Error('Workflow not found or not yet saved')
      }
      blocks = draftData.blocks
      edges = draftData.edges
      loops = draftData.loops
      parallels = draftData.parallels
    } else {
      const deployedData = await loadDeployedWorkflowState(workflowId)
      blocks = deployedData.blocks
      edges = deployedData.edges
      loops = deployedData.loops
      parallels = deployedData.parallels
    }

    // Merge block states
    const mergedStates = mergeSubblockState(blocks)

    // Get and decrypt environment variables
    const { personalEncrypted, workspaceEncrypted } = await getPersonalAndWorkspaceEnv(
      userId,
      workflow.workspaceId || undefined
    )
    const variables = EnvVarsSchema.parse({ ...personalEncrypted, ...workspaceEncrypted })

    await loggingSession.safeStart({
      userId,
      workspaceId: workflow.workspaceId,
      variables,
    })

    // Process block states with env var substitution
    const currentBlockStates = await Object.entries(mergedStates).reduce(
      async (accPromise, [id, block]) => {
        const acc = await accPromise
        acc[id] = await Object.entries(block.subBlocks).reduce(
          async (subAccPromise, [key, subBlock]) => {
            const subAcc = await subAccPromise
            let value = subBlock.value

            if (typeof value === 'string' && value.includes('{{') && value.includes('}}')) {
              const matches = value.match(/{{([^}]+)}}/g)
              if (matches) {
                for (const match of matches) {
                  const varName = match.slice(2, -2)
                  const encryptedValue = variables[varName]
                  if (encryptedValue) {
                    const { decrypted } = await decryptSecret(encryptedValue)
                    value = (value as string).replace(match, decrypted)
                  }
                }
              }
            }

            subAcc[key] = value
            return subAcc
          },
          Promise.resolve({} as Record<string, any>)
        )
        return acc
      },
      Promise.resolve({} as Record<string, Record<string, any>>)
    )

    // Decrypt all env vars
    const decryptedEnvVars: Record<string, string> = {}
    for (const [key, encryptedValue] of Object.entries(variables)) {
      const { decrypted } = await decryptSecret(encryptedValue)
      decryptedEnvVars[key] = decrypted
    }

    // Process response format
    const processedBlockStates = Object.entries(currentBlockStates).reduce(
      (acc, [blockId, blockState]) => {
        if (blockState.responseFormat && typeof blockState.responseFormat === 'string') {
          const responseFormatValue = blockState.responseFormat.trim()
          if (responseFormatValue && !responseFormatValue.startsWith('<')) {
            try {
              acc[blockId] = {
                ...blockState,
                responseFormat: JSON.parse(responseFormatValue),
              }
            } catch {
              acc[blockId] = {
                ...blockState,
                responseFormat: undefined,
              }
            }
          } else {
            acc[blockId] = blockState
          }
        } else {
          acc[blockId] = blockState
        }
        return acc
      },
      {} as Record<string, Record<string, any>>
    )

    const workflowVariables = (workflow.variables as Record<string, any>) || {}

    // Serialize workflow
    const serializedWorkflow = new Serializer().serializeWorkflow(
      mergedStates,
      edges,
      loops,
      parallels,
      true
    )

    processedInput = input || {}

    // Create and execute workflow
    const contextExtensions: any = {
      stream: false,
      selectedOutputs,
      executionId,
      workspaceId: workflow.workspaceId,
      isDeployedContext: triggerType !== 'manual',
    }

    const executorInstance = new Executor({
      workflow: serializedWorkflow,
      currentBlockStates: processedBlockStates,
      envVarValues: decryptedEnvVars,
      workflowInput: processedInput,
      workflowVariables,
      contextExtensions,
    })
    
    loggingSession.setupExecutor(executorInstance)
    
    const result = await executorInstance.execute(workflowId) as ExecutionResult

    // Build trace spans for logging
    const { traceSpans, totalDuration } = buildTraceSpans(result)

    // Update workflow run counts
    if (result.success) {
      await updateWorkflowRunCounts(workflowId)
    }

    // Complete logging session
    await loggingSession.safeComplete({
      endedAt: new Date().toISOString(),
      totalDurationMs: totalDuration || 0,
      finalOutput: result.output || {},
      traceSpans: traceSpans || [],
      workflowInput: processedInput,
    })

    logger.info(`[${requestId}] Workflow execution completed`, {
      success: result.success,
      duration: result.metadata?.duration,
    })

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
    logger.error(`[${requestId}] Execution failed:`, error)
    
    await loggingSession.safeComplete({
      endedAt: new Date().toISOString(),
      totalDurationMs: 0,
      finalOutput: {},
      traceSpans: [],
      workflowInput: processedInput,
    })
    
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
    let executorInstance: Executor | null = null

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let processedInput = input || {}
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

        // Load workflow state from database
        // For manual runs, use draft state from normalized tables
        // For API/webhook/schedule runs, use deployed state
        let blocks, edges, loops, parallels
        
        if (triggerType === 'manual') {
          // Load draft state from normalized tables
          const draftData = await loadWorkflowFromNormalizedTables(workflowId)
          
          if (!draftData) {
            throw new Error('Workflow not found or not yet saved. Please save the workflow first.')
          }
          
          blocks = draftData.blocks
          edges = draftData.edges
          loops = draftData.loops
          parallels = draftData.parallels
          
          logger.info(`[${requestId}] Using draft workflow state from normalized tables`)
        } else {
          // Use deployed state for API/webhook/schedule executions
          const deployedData = await loadDeployedWorkflowState(workflowId)
          blocks = deployedData.blocks
          edges = deployedData.edges
          loops = deployedData.loops
          parallels = deployedData.parallels
          
          logger.info(`[${requestId}] Using deployed workflow state`)
        }

        // Merge block states
        const mergedStates = mergeSubblockState(blocks)

        // Get environment variables with decryption
        const { personalEncrypted, workspaceEncrypted } = await getPersonalAndWorkspaceEnv(
          userId,
          workflow.workspaceId || undefined
        )
        const variables = EnvVarsSchema.parse({ ...personalEncrypted, ...workspaceEncrypted })

        // Start logging session
        await loggingSession.safeStart({
          userId,
          workspaceId: workflow.workspaceId,
          variables,
        })

        // Process block states with env var substitution
        const currentBlockStates = await Object.entries(mergedStates).reduce(
          async (accPromise, [id, block]) => {
            const acc = await accPromise
            acc[id] = await Object.entries(block.subBlocks).reduce(
              async (subAccPromise, [key, subBlock]) => {
                const subAcc = await subAccPromise
                let value = subBlock.value

                // Decrypt environment variables in block values
                if (typeof value === 'string' && value.includes('{{') && value.includes('}}')) {
                  const matches = value.match(/{{([^}]+)}}/g)
                  if (matches) {
                    for (const match of matches) {
                      const varName = match.slice(2, -2)
                      const encryptedValue = variables[varName]
                      if (encryptedValue) {
                        const { decrypted } = await decryptSecret(encryptedValue)
                        value = (value as string).replace(match, decrypted)
                      }
                    }
                  }
                }

                subAcc[key] = value
                return subAcc
              },
              Promise.resolve({} as Record<string, any>)
            )
            return acc
          },
          Promise.resolve({} as Record<string, Record<string, any>>)
        )

        // Decrypt all env vars
        const decryptedEnvVars: Record<string, string> = {}
        for (const [key, encryptedValue] of Object.entries(variables)) {
          const { decrypted } = await decryptSecret(encryptedValue)
          decryptedEnvVars[key] = decrypted
        }

        // Process block states (handle response format parsing)
        const processedBlockStates = Object.entries(currentBlockStates).reduce(
          (acc, [blockId, blockState]) => {
            if (blockState.responseFormat && typeof blockState.responseFormat === 'string') {
              const responseFormatValue = blockState.responseFormat.trim()
              if (responseFormatValue && !responseFormatValue.startsWith('<')) {
                try {
                  acc[blockId] = {
                    ...blockState,
                    responseFormat: JSON.parse(responseFormatValue),
                  }
                } catch {
                  acc[blockId] = {
                    ...blockState,
                    responseFormat: undefined,
                  }
                }
              } else {
                acc[blockId] = blockState
              }
            } else {
              acc[blockId] = blockState
            }
            return acc
          },
          {} as Record<string, Record<string, any>>
        )

        // Get workflow variables
        const workflowVariables = (workflow.variables as Record<string, any>) || {}

        // Serialize workflow
        const serializedWorkflow = new Serializer().serializeWorkflow(
          mergedStates,
          edges,
          loops,
          parallels,
          true
        )

        // Update processedInput
        processedInput = input || {}

        // Create executor with SSE callbacks
        const contextExtensions: any = {
          stream: true,
          selectedOutputs,
          executionId,
          workspaceId: workflow.workspaceId,
          isDeployedContext: false, // Set to false for client-initiated executions
          
          // Callback when a block starts
          onBlockStart: async (blockId: string, blockName: string, blockType: string) => {
            logger.info(`[${requestId}] 🔷 onBlockStart called:`, { blockId, blockName, blockType })
            sendEvent({
              type: 'block:started',
              timestamp: new Date().toISOString(),
              executionId,
              workflowId,
              data: {
                blockId,
                blockName,
                blockType,
              },
            })
          },
          
          // Callback when a block completes
          onBlockComplete: async (blockId: string, output: any) => {
            const block = serializedWorkflow.blocks.find((b: any) => b.id === blockId)
            logger.info(`[${requestId}] ✓ onBlockComplete called:`, { blockId })
            
            sendEvent({
              type: 'block:completed',
              timestamp: new Date().toISOString(),
              executionId,
              workflowId,
              data: {
                blockId,
                blockName: block?.metadata?.name || '',
                blockType: block?.metadata?.id || '',
                output,
                durationMs: output.executionTime || 0,
              },
            })
          },
          
          // Callback for streaming content
          onStream: async (streamingExec: StreamingExecution) => {
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
          },
        }

        // Create and execute workflow
        executorInstance = new Executor({
          workflow: serializedWorkflow,
          currentBlockStates: processedBlockStates,
          envVarValues: decryptedEnvVars,
          workflowInput: processedInput,
          workflowVariables,
          contextExtensions,
        })
        
        // Setup logging session with executor
        loggingSession.setupExecutor(executorInstance)
        
        // Execute workflow (no startBlockId, let executor determine the start block)
        const result = await executorInstance.execute(workflowId) as ExecutionResult

        // Check if execution was cancelled
        if (result.error === 'Workflow execution was cancelled') {
          logger.info(`[${requestId}] Workflow execution was cancelled`)
          
          // Build trace spans for billing (still bill for cancelled executions)
          const { traceSpans, totalDuration } = buildTraceSpans(result)
          
          // Complete logging session with cancelled status
          await loggingSession.safeComplete({
            endedAt: new Date().toISOString(),
            totalDurationMs: totalDuration || 0,
            finalOutput: result.output || {},
            traceSpans: traceSpans || [],
            workflowInput: processedInput,
          })

          // Send cancellation event
          sendEvent({
            type: 'execution:cancelled',
            timestamp: new Date().toISOString(),
            executionId,
            workflowId,
            data: {
              duration: result.metadata?.duration || 0,
            },
          })
          
          return // Exit early for cancelled execution
        }

        logger.info(`[${requestId}] Workflow execution completed`, {
          success: result.success,
          duration: result.metadata?.duration,
        })

        // Build trace spans for logging
        const { traceSpans, totalDuration } = buildTraceSpans(result)

        // Update workflow run counts
        if (result.success) {
          await updateWorkflowRunCounts(workflowId)
        }

        // Complete logging session
        await loggingSession.safeComplete({
          endedAt: new Date().toISOString(),
          totalDurationMs: totalDuration || 0,
          finalOutput: result.output || {},
          traceSpans: traceSpans || [],
          workflowInput: processedInput,
        })

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
        logger.error(`[${requestId}] Workflow execution failed:`, error)
        
        // Complete logging session with error
        await loggingSession.safeComplete({
          endedAt: new Date().toISOString(),
          totalDurationMs: 0,
          finalOutput: {},
          traceSpans: [],
          workflowInput: processedInput,
        })
        
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
        logger.info(`[${requestId}] Client aborted SSE stream, cancelling executor`)
        
        // Cancel the executor if it exists
        if (executorInstance) {
          executorInstance.cancel()
        }
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

