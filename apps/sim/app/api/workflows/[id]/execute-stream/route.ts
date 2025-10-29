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

const logger = createLogger('ExecuteStreamAPI')

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
 * POST /api/workflows/[id]/execute-stream
 * 
 * Server-side workflow execution with SSE streaming.
 * This endpoint runs the executor on the server and streams execution events to the client.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const requestId = generateRequestId()
  const workflowId = params.id

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

    // Parse request body
    const body = await req.json()
    const {
      input,
      selectedOutputs = [],
      triggerType = 'manual',
    } = body

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

    logger.info(`[${requestId}] Starting server-side execution stream`, {
      workflowId,
      userId,
      hasInput: !!input,
      triggerType,
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

    // Create SSE stream with execution inside start method
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

