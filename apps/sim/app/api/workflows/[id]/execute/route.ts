import { type NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { z } from 'zod'
import { authenticateApiKeyFromHeader, updateApiKeyLastUsed } from '@/lib/api-key/service'
import { getSession } from '@/lib/auth'
import { checkServerSideUsageLimits } from '@/lib/billing'
import { createLogger } from '@/lib/logs/console/logger'
import { LoggingSession } from '@/lib/logs/execution/logging-session'
<<<<<<< HEAD
import { generateRequestId, SSE_HEADERS } from '@/lib/utils'
import { executeWorkflowCore } from '@/lib/workflows/executor/execution-core'
import { type ExecutionEvent, encodeSSEEvent } from '@/lib/workflows/executor/execution-events'
import { validateWorkflowAccess } from '@/app/api/workflows/middleware'
import type { StreamingExecution } from '@/executor/types'
import type { SubflowType } from '@/stores/workflows/workflow/types'
=======
import { buildTraceSpans } from '@/lib/logs/execution/trace-spans/trace-spans'
import { decryptSecret, generateRequestId } from '@/lib/utils'
import { loadDeployedWorkflowState } from '@/lib/workflows/db-helpers'
import { StartBlockPath, TriggerUtils } from '@/lib/workflows/triggers'
import {
  createHttpResponseFromBlock,
  updateWorkflowRunCounts,
  workflowHasResponseBlock,
} from '@/lib/workflows/utils'
import { validateWorkflowAccess } from '@/app/api/workflows/middleware'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'
import { filterEdgesFromTriggerBlocks } from '@/app/workspace/[workspaceId]/w/[workflowId]/lib/workflow-execution-utils'
import { Executor } from '@/executor'
import type { ExecutionResult } from '@/executor/types'
import { Serializer } from '@/serializer'
import { RateLimitError, RateLimiter, type TriggerType } from '@/services/queue'
import { mergeSubblockState } from '@/stores/workflows/server-utils'

const logger = createLogger('WorkflowExecuteAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
>>>>>>> origin/improvement/sim-294

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

<<<<<<< HEAD
    // Filter out logs and internal metadata for API responses
    const filteredResult = {
=======
    const deployedData = await loadDeployedWorkflowState(workflowId)
    const { blocks, edges, loops, parallels } = deployedData
    logger.info(`[${requestId}] Using deployed state for workflow execution: ${workflowId}`)
    logger.debug(`[${requestId}] Deployed data loaded:`, {
      blocksCount: Object.keys(blocks || {}).length,
      edgesCount: (edges || []).length,
      loopsCount: Object.keys(loops || {}).length,
      parallelsCount: Object.keys(parallels || {}).length,
    })

    const mergedStates = mergeSubblockState(blocks)

    const { personalEncrypted, workspaceEncrypted } = await getPersonalAndWorkspaceEnv(
      actorUserId,
      workflow.workspaceId || undefined
    )
    const variables = EnvVarsSchema.parse({ ...personalEncrypted, ...workspaceEncrypted })

    await loggingSession.safeStart({
      userId: actorUserId,
      workspaceId: workflow.workspaceId,
      variables,
    })

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
                  if (!encryptedValue) {
                    throw new Error(`Environment variable "${varName}" was not found`)
                  }

                  try {
                    const { decrypted } = await decryptSecret(encryptedValue)
                    value = (value as string).replace(match, decrypted)
                  } catch (error: any) {
                    logger.error(
                      `[${requestId}] Error decrypting environment variable "${varName}"`,
                      error
                    )
                    throw new Error(
                      `Failed to decrypt environment variable "${varName}": ${error.message}`
                    )
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

    const decryptedEnvVars: Record<string, string> = {}
    for (const [key, encryptedValue] of Object.entries(variables)) {
      try {
        const { decrypted } = await decryptSecret(encryptedValue)
        decryptedEnvVars[key] = decrypted
      } catch (error: any) {
        logger.error(`[${requestId}] Failed to decrypt environment variable "${key}"`, error)
        throw new Error(`Failed to decrypt environment variable "${key}": ${error.message}`)
      }
    }

    const processedBlockStates = Object.entries(currentBlockStates).reduce(
      (acc, [blockId, blockState]) => {
        if (blockState.responseFormat && typeof blockState.responseFormat === 'string') {
          const responseFormatValue = blockState.responseFormat.trim()

          if (responseFormatValue.startsWith('<') && responseFormatValue.includes('>')) {
            logger.debug(
              `[${requestId}] Response format contains variable reference for block ${blockId}`
            )
            acc[blockId] = blockState
          } else if (responseFormatValue === '') {
            acc[blockId] = {
              ...blockState,
              responseFormat: undefined,
            }
          } else {
            try {
              logger.debug(`[${requestId}] Parsing responseFormat for block ${blockId}`)
              const parsedResponseFormat = JSON.parse(responseFormatValue)

              acc[blockId] = {
                ...blockState,
                responseFormat: parsedResponseFormat,
              }
            } catch (error) {
              logger.warn(
                `[${requestId}] Failed to parse responseFormat for block ${blockId}, using undefined`,
                error
              )
              acc[blockId] = {
                ...blockState,
                responseFormat: undefined,
              }
            }
          }
        } else {
          acc[blockId] = blockState
        }
        return acc
      },
      {} as Record<string, Record<string, any>>
    )

    const workflowVariables = (workflow.variables as Record<string, any>) || {}

    if (Object.keys(workflowVariables).length > 0) {
      logger.debug(
        `[${requestId}] Loaded ${Object.keys(workflowVariables).length} workflow variables for: ${workflowId}`
      )
    } else {
      logger.debug(`[${requestId}] No workflow variables found for: ${workflowId}`)
    }

    // Filter out edges between trigger blocks - triggers are independent entry points
    const filteredEdges = filterEdgesFromTriggerBlocks(mergedStates, edges)

    logger.debug(`[${requestId}] Serializing workflow: ${workflowId}`)
    const serializedWorkflow = new Serializer().serializeWorkflow(
      mergedStates,
      filteredEdges,
      loops,
      parallels,
      true
    )

    const preferredTriggerType = streamConfig?.workflowTriggerType || 'api'
    const startBlock = TriggerUtils.findStartBlock(mergedStates, preferredTriggerType, false)

    if (!startBlock) {
      const errorMsg =
        preferredTriggerType === 'api'
          ? 'No API trigger block found. Add an API Trigger block to this workflow.'
          : 'No chat trigger block found. Add a Chat Trigger block to this workflow.'
      logger.error(`[${requestId}] ${errorMsg}`)
      throw new Error(errorMsg)
    }

    const { blockId: startBlockId, block: triggerBlock, path: startPath } = startBlock

    if (startPath !== StartBlockPath.LEGACY_STARTER) {
      const outgoingConnections = serializedWorkflow.connections.filter(
        (conn) => conn.source === startBlockId
      )
      if (outgoingConnections.length === 0) {
        logger.error(`[${requestId}] API trigger has no outgoing connections`)
        throw new Error('API Trigger block must be connected to other blocks to execute')
      }
    }

    const contextExtensions: any = {
      executionId,
      workspaceId: workflow.workspaceId,
      isDeployedContext: true,
    }

    if (streamConfig?.enabled) {
      contextExtensions.stream = true
      contextExtensions.selectedOutputs = streamConfig.selectedOutputs || []
      contextExtensions.edges = filteredEdges.map((e: any) => ({
        source: e.source,
        target: e.target,
      }))
      contextExtensions.onStream = streamConfig.onStream
      contextExtensions.onBlockComplete = streamConfig.onBlockComplete
    }

    const executor = new Executor({
      workflow: serializedWorkflow,
      currentBlockStates: processedBlockStates,
      envVarValues: decryptedEnvVars,
      workflowInput: processedInput,
      workflowVariables,
      contextExtensions,
    })

    loggingSession.setupExecutor(executor)

    const result = (await executor.execute(workflowId, startBlockId)) as ExecutionResult

    logger.info(`[${requestId}] Workflow execution completed: ${workflowId}`, {
>>>>>>> origin/improvement/sim-294
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
    logger.error(`[${options.requestId}] Non-SSE execution failed:`, error)

    // Extract execution result from error if available
    const executionResult = error.executionResult

    return NextResponse.json(
      {
        success: false,
        output: executionResult?.output,
        error: executionResult?.error || error.message || 'Execution failed',
        metadata: executionResult?.metadata
          ? {
              duration: executionResult.metadata.duration,
              startTime: executionResult.metadata.startTime,
              endTime: executionResult.metadata.endTime,
            }
          : undefined,
      },
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
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
<<<<<<< HEAD
      userId = authResult.userId
=======
    }

    logger.info(`[${requestId}] Input passed to workflow:`, parsedBody)

    const extractExecutionParams = (req: NextRequest, body: any) => {
      const internalSecret = req.headers.get('X-Internal-Secret')
      const isInternalCall = internalSecret === env.INTERNAL_API_SECRET

      return {
        isSecureMode: body.isSecureMode !== undefined ? body.isSecureMode : isInternalCall,
        streamResponse: req.headers.get('X-Stream-Response') === 'true' || body.stream === true,
        selectedOutputs:
          body.selectedOutputs ||
          (req.headers.get('X-Selected-Outputs')
            ? JSON.parse(req.headers.get('X-Selected-Outputs')!)
            : undefined),
        workflowTriggerType:
          body.workflowTriggerType || (isInternalCall && body.stream ? 'chat' : 'api'),
        input: body,
      }
    }

    const {
      isSecureMode: finalIsSecureMode,
      streamResponse,
      selectedOutputs,
      workflowTriggerType,
      input: rawInput,
    } = extractExecutionParams(request as NextRequest, parsedBody)

    let authenticatedUserId: string
    let triggerType: TriggerType = 'manual'

    if (finalIsSecureMode) {
      authenticatedUserId = validation.workflow.userId
      triggerType = 'manual'
>>>>>>> origin/improvement/sim-294
    } else {
      const session = await getSession()
      if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      userId = session.user.id
    }

<<<<<<< HEAD
    // Validate workflow access (don't require deployment for manual client runs)
    const workflowValidation = await validateWorkflowAccess(req, workflowId, false)
    if (workflowValidation.error) {
      return NextResponse.json(
        { error: workflowValidation.error.message },
        { status: workflowValidation.error.status }
      )
    }
    const workflow = workflowValidation.workflow!
=======
    const executionId = uuidv4()

    let processedInput = rawInput
    logger.info(`[${requestId}] Raw input received:`, JSON.stringify(rawInput, null, 2))

    try {
      const deployedData = await loadDeployedWorkflowState(workflowId)
      const blocks = deployedData.blocks || {}
      logger.info(`[${requestId}] Loaded ${Object.keys(blocks).length} blocks from workflow`)

      const startTriggerBlock = Object.values(blocks).find(
        (block: any) => block.type === 'start_trigger'
      ) as any
      const apiTriggerBlock = Object.values(blocks).find(
        (block: any) => block.type === 'api_trigger'
      ) as any
      logger.info(`[${requestId}] Start trigger block found:`, !!startTriggerBlock)
      logger.info(`[${requestId}] API trigger block found:`, !!apiTriggerBlock)

      const triggerBlock = startTriggerBlock || apiTriggerBlock

      if (triggerBlock?.subBlocks?.inputFormat?.value) {
        const inputFormat = triggerBlock.subBlocks.inputFormat.value as Array<{
          name: string
          type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'files'
        }>
        logger.info(
          `[${requestId}] Input format fields:`,
          inputFormat.map((f) => `${f.name}:${f.type}`).join(', ')
        )

        const fileFields = inputFormat.filter((field) => field.type === 'files')
        logger.info(`[${requestId}] Found ${fileFields.length} file-type fields`)

        if (fileFields.length > 0 && typeof rawInput === 'object' && rawInput !== null) {
          const executionContext = {
            workspaceId: validation.workflow.workspaceId,
            workflowId,
            executionId,
          }

          for (const fileField of fileFields) {
            const fieldValue = rawInput[fileField.name]

            if (fieldValue && typeof fieldValue === 'object') {
              const uploadedFiles = await processExecutionFiles(
                fieldValue,
                executionContext,
                requestId,
                authenticatedUserId
              )

              if (uploadedFiles.length > 0) {
                processedInput = {
                  ...processedInput,
                  [fileField.name]: uploadedFiles,
                }
                logger.info(
                  `[${requestId}] Successfully processed ${uploadedFiles.length} file(s) for field: ${fileField.name}`
                )
              }
            }
          }
        }
      }
    } catch (error) {
      logger.error(`[${requestId}] Failed to process file uploads:`, error)
      const errorMessage = error instanceof Error ? error.message : 'Failed to process file uploads'
      return createErrorResponse(errorMessage, 400)
    }

    const input = processedInput

    const userSubscription = await getHighestPrioritySubscription(authenticatedUserId)
>>>>>>> origin/improvement/sim-294

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

    const { input, selectedOutputs = [], triggerType = 'manual', stream: streamParam } = body

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
    if (
      triggerType === 'api' ||
      triggerType === 'chat' ||
      triggerType === 'webhook' ||
      triggerType === 'schedule' ||
      triggerType === 'manual'
    ) {
      loggingTriggerType = triggerType as LoggingTriggerType
    }
    const loggingSession = new LoggingSession(
      workflowId,
      executionId,
      loggingTriggerType,
      requestId
    )

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
    let executorInstance: any = null
    let isStreamClosed = false

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const sendEvent = (event: ExecutionEvent) => {
          if (isStreamClosed) return

          try {
            logger.info(`[${requestId}] 📤 Sending SSE event:`, {
              type: event.type,
              data: event.data,
            })
            controller.enqueue(encodeSSEEvent(event))
          } catch {
            // Stream closed - stop sending events
            isStreamClosed = true
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
          const onBlockStart = async (
            blockId: string,
            blockName: string,
            blockType: string,
            iterationContext?: {
              iterationCurrent: number
              iterationTotal: number
              iterationType: SubflowType
            }
          ) => {
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
                ...(iterationContext && {
                  iterationCurrent: iterationContext.iterationCurrent,
                  iterationTotal: iterationContext.iterationTotal,
                  iterationType: iterationContext.iterationType,
                }),
              },
            })
          }

          const onBlockComplete = async (
            blockId: string,
            blockName: string,
            blockType: string,
            callbackData: any,
            iterationContext?: {
              iterationCurrent: number
              iterationTotal: number
              iterationType: SubflowType
            }
          ) => {
            // Check if this is an error completion
            const hasError = callbackData.output?.error

            if (hasError) {
              logger.info(`[${requestId}] ✗ onBlockComplete (error) called:`, {
                blockId,
                blockName,
                blockType,
                error: callbackData.output.error,
              })
              sendEvent({
                type: 'block:error',
                timestamp: new Date().toISOString(),
                executionId,
                workflowId,
                data: {
                  blockId,
                  blockName,
                  blockType,
                  input: callbackData.input,
                  error: callbackData.output.error,
                  durationMs: callbackData.executionTime || 0,
                  ...(iterationContext && {
                    iterationCurrent: iterationContext.iterationCurrent,
                    iterationTotal: iterationContext.iterationTotal,
                    iterationType: iterationContext.iterationType,
                  }),
                },
              })
            } else {
              logger.info(`[${requestId}] ✓ onBlockComplete called:`, {
                blockId,
                blockName,
                blockType,
              })
              sendEvent({
                type: 'block:completed',
                timestamp: new Date().toISOString(),
                executionId,
                workflowId,
                data: {
                  blockId,
                  blockName,
                  blockType,
                  input: callbackData.input,
                  output: callbackData.output,
                  durationMs: callbackData.executionTime || 0,
                  ...(iterationContext && {
                    iterationCurrent: iterationContext.iterationCurrent,
                    iterationTotal: iterationContext.iterationTotal,
                    iterationType: iterationContext.iterationType,
                  }),
                },
              })
            }
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
            onExecutorCreated: (executor) => {
              executorInstance = executor
            },
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

          // Extract execution result from error if available
          const executionResult = error.executionResult

          // Send error event
          sendEvent({
            type: 'execution:error',
            timestamp: new Date().toISOString(),
            executionId,
            workflowId,
            data: {
              error: executionResult?.error || error.message || 'Unknown error',
              duration: executionResult?.metadata?.duration || 0,
            },
          })
        } finally {
          // Close the stream if not already closed
          if (!isStreamClosed) {
            try {
              controller.enqueue(encoder.encode('data: [DONE]\n\n'))
              controller.close()
            } catch {
              // Stream already closed - nothing to do
            }
          }
        }
      },
      cancel() {
        isStreamClosed = true
        logger.info(`[${requestId}] Client aborted SSE stream, cancelling executor`)

        // Cancel the executor if it exists
        if (executorInstance && typeof executorInstance.cancel === 'function') {
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
