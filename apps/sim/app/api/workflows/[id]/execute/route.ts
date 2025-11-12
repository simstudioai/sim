import { type NextRequest, NextResponse } from 'next/server'
import { validate as uuidValidate, v4 as uuidv4 } from 'uuid'
import { z } from 'zod'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { checkServerSideUsageLimits } from '@/lib/billing'
import { processInputFileFields } from '@/lib/execution/files'
import { createLogger } from '@/lib/logs/console/logger'
import { LoggingSession } from '@/lib/logs/execution/logging-session'
import { generateRequestId, SSE_HEADERS } from '@/lib/utils'
import {
  loadDeployedWorkflowState,
  loadWorkflowFromNormalizedTables,
} from '@/lib/workflows/db-helpers'
import { executeWorkflowCore } from '@/lib/workflows/executor/execution-core'
import { type ExecutionEvent, encodeSSEEvent } from '@/lib/workflows/executor/execution-events'
import { PauseResumeManager } from '@/lib/workflows/executor/human-in-the-loop-manager'
import { createStreamingResponse } from '@/lib/workflows/streaming'
import { validateWorkflowAccess } from '@/app/api/workflows/middleware'
import { type ExecutionMetadata, ExecutionSnapshot } from '@/executor/execution/snapshot'
import type { StreamingExecution } from '@/executor/types'
import { Serializer } from '@/serializer'
import type { SubflowType } from '@/stores/workflows/workflow/types'

const logger = createLogger('WorkflowExecuteAPI')

const ExecuteWorkflowSchema = z.object({
  selectedOutputs: z.array(z.string()).optional().default([]),
  triggerType: z.enum(['api', 'webhook', 'schedule', 'manual', 'chat']).optional(),
  stream: z.boolean().optional(),
  useDraftState: z.boolean().optional(),
  input: z.any().optional(),
  startBlockId: z.string().optional(),
  // Optional workflow state override (for executing diff workflows)
  workflowStateOverride: z
    .object({
      blocks: z.record(z.any()),
      edges: z.array(z.any()),
      loops: z.record(z.any()).optional(),
      parallels: z.record(z.any()).optional(),
    })
    .optional(),
})

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
 * Execute workflow with streaming support - used by chat and other streaming endpoints
 *
 * This is a wrapper function that:
 * - Checks usage limits before execution (protects chat and streaming paths)
 * - Logs usage limit errors to the database for user visibility
 * - Supports streaming callbacks (onStream, onBlockComplete)
 * - Returns ExecutionResult instead of NextResponse
 *
 * Used by:
 * - Chat execution (/api/chat/[identifier]/route.ts)
 * - Streaming responses (lib/workflows/streaming.ts)
 *
 * Note: The POST handler in this file calls executeWorkflowCore() directly and has
 * its own usage check. This wrapper provides convenience and built-in protection
 * for callers that need streaming support.
 */
export async function executeWorkflow(
  workflow: any,
  requestId: string,
  input: any | undefined,
  actorUserId: string,
  streamConfig?: {
    enabled: boolean
    selectedOutputs?: string[]
    isSecureMode?: boolean
    workflowTriggerType?: 'api' | 'chat'
    onStream?: (streamingExec: any) => Promise<void>
    onBlockComplete?: (blockId: string, output: any) => Promise<void>
    skipLoggingComplete?: boolean
  },
  providedExecutionId?: string
): Promise<any> {
  const workflowId = workflow.id
  const executionId = providedExecutionId || uuidv4()
  const triggerType = streamConfig?.workflowTriggerType || 'api'
  const loggingSession = new LoggingSession(workflowId, executionId, triggerType, requestId)

  try {
    const usageCheck = await checkServerSideUsageLimits(actorUserId)
    if (usageCheck.isExceeded) {
      logger.warn(
        `[${requestId}] User ${actorUserId} has exceeded usage limits. Blocking workflow execution.`,
        {
          currentUsage: usageCheck.currentUsage,
          limit: usageCheck.limit,
          workflowId,
          triggerType,
        }
      )

      await loggingSession.safeStart({
        userId: actorUserId,
        workspaceId: workflow.workspaceId || '',
        variables: {},
      })

      await loggingSession.safeCompleteWithError({
        error: {
          message:
            usageCheck.message || 'Usage limit exceeded. Please upgrade your plan to continue.',
          stackTrace: undefined,
        },
        traceSpans: [],
      })

      throw new UsageLimitError(
        usageCheck.message || 'Usage limit exceeded. Please upgrade your plan to continue.'
      )
    }

    const metadata: ExecutionMetadata = {
      requestId,
      executionId,
      workflowId,
      workspaceId: workflow.workspaceId,
      userId: actorUserId,
      triggerType,
      useDraftState: false,
      startTime: new Date().toISOString(),
    }

    const snapshot = new ExecutionSnapshot(
      metadata,
      workflow,
      input,
      {},
      workflow.variables || {},
      streamConfig?.selectedOutputs || []
    )

    const result = await executeWorkflowCore({
      snapshot,
      callbacks: {
        onStream: streamConfig?.onStream,
        onBlockComplete: streamConfig?.onBlockComplete
          ? async (blockId: string, _blockName: string, _blockType: string, output: any) => {
              await streamConfig.onBlockComplete!(blockId, output)
            }
          : undefined,
      },
      loggingSession,
    })

    if (result.status === 'paused') {
      if (!result.snapshotSeed) {
        logger.error(`[${requestId}] Missing snapshot seed for paused execution`, {
          executionId,
        })
      } else {
        await PauseResumeManager.persistPauseResult({
          workflowId,
          executionId,
          pausePoints: result.pausePoints || [],
          snapshotSeed: result.snapshotSeed,
          executorUserId: result.metadata?.userId,
        })
      }
    } else {
      await PauseResumeManager.processQueuedResumes(executionId)
    }

    if (streamConfig?.skipLoggingComplete) {
      return {
        ...result,
        _streamingMetadata: {
          loggingSession,
          processedInput: input,
        },
      }
    }

    return result
  } catch (error: any) {
    logger.error(`[${requestId}] Workflow execution failed:`, error)
    throw error
  }
}

export function createFilteredResult(result: any) {
  return {
    ...result,
    logs: undefined,
    metadata: result.metadata
      ? {
          ...result.metadata,
          workflowConnections: undefined,
        }
      : undefined,
  }
}

function resolveOutputIds(
  selectedOutputs: string[] | undefined,
  blocks: Record<string, any>
): string[] | undefined {
  if (!selectedOutputs || selectedOutputs.length === 0) {
    return selectedOutputs
  }

  return selectedOutputs.map((outputId) => {
    const underscoreIndex = outputId.indexOf('_')
    const dotIndex = outputId.indexOf('.')
    if (underscoreIndex > 0) {
      const maybeUuid = outputId.substring(0, underscoreIndex)
      if (uuidValidate(maybeUuid)) {
        return outputId
      }
    }

    if (dotIndex > 0) {
      const maybeUuid = outputId.substring(0, dotIndex)
      if (uuidValidate(maybeUuid)) {
        return `${outputId.substring(0, dotIndex)}_${outputId.substring(dotIndex + 1)}`
      }
    }

    if (uuidValidate(outputId)) {
      return outputId
    }

    if (dotIndex === -1) {
      logger.warn(`Invalid output ID format (missing dot): ${outputId}`)
      return outputId
    }

    const blockName = outputId.substring(0, dotIndex)
    const path = outputId.substring(dotIndex + 1)

    const normalizedBlockName = blockName.toLowerCase().replace(/\s+/g, '')
    const block = Object.values(blocks).find((b: any) => {
      const normalized = (b.name || '').toLowerCase().replace(/\s+/g, '')
      return normalized === normalizedBlockName
    })

    if (!block) {
      logger.warn(`Block not found for name: ${blockName} (from output ID: ${outputId})`)
      return outputId
    }

    const resolvedId = `${block.id}_${path}`
    logger.debug(`Resolved output ID: ${outputId} -> ${resolvedId}`)
    return resolvedId
  })
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
    // Authenticate user (API key, session, or internal JWT)
    const auth = await checkHybridAuth(req, { requireWorkflowId: false })
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }
    const userId = auth.userId

    // Validate workflow access (don't require deployment for manual client runs)
    const workflowValidation = await validateWorkflowAccess(req, workflowId, false)
    if (workflowValidation.error) {
      return NextResponse.json(
        { error: workflowValidation.error.message },
        { status: workflowValidation.error.status }
      )
    }
    const workflow = workflowValidation.workflow!

    let body: any = {}
    try {
      const text = await req.text()
      if (text) {
        body = JSON.parse(text)
      }
    } catch (error) {
      logger.warn(`[${requestId}] Failed to parse request body, using defaults`)
    }

    const validation = ExecuteWorkflowSchema.safeParse(body)
    if (!validation.success) {
      logger.warn(`[${requestId}] Invalid request body:`, validation.error.errors)
      return NextResponse.json(
        {
          error: 'Invalid request body',
          details: validation.error.errors.map((e) => ({
            path: e.path.join('.'),
            message: e.message,
          })),
        },
        { status: 400 }
      )
    }

    const defaultTriggerType = auth.authType === 'api_key' ? 'api' : 'manual'

    const {
      selectedOutputs,
      triggerType = defaultTriggerType,
      stream: streamParam,
      useDraftState,
      input: validatedInput,
      workflowStateOverride,
    } = validation.data

    // For API key auth, the entire body is the input (except for our control fields)
    // For session auth, the input is explicitly provided in the input field
    const input =
      auth.authType === 'api_key'
        ? (() => {
            const {
              selectedOutputs,
              triggerType,
              stream,
              useDraftState,
              workflowStateOverride,
              ...rest
            } = body
            return Object.keys(rest).length > 0 ? rest : validatedInput
          })()
        : validatedInput

    const shouldUseDraftState = useDraftState ?? auth.authType === 'session'

    const streamHeader = req.headers.get('X-Stream-Response') === 'true'
    const enableSSE = streamHeader || streamParam === true

    logger.info(`[${requestId}] Starting server-side execution`, {
      workflowId,
      userId,
      hasInput: !!input,
      triggerType,
      authType: auth.authType,
      streamParam,
      streamHeader,
      enableSSE,
    })

    const executionId = uuidv4()
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

    // Check usage limits for this POST handler execution path
    // Architecture note: This handler calls executeWorkflowCore() directly (both SSE and non-SSE paths).
    // The executeWorkflow() wrapper function (used by chat) has its own check (line 54).
    const usageCheck = await checkServerSideUsageLimits(userId)
    if (usageCheck.isExceeded) {
      logger.warn(`[${requestId}] User ${userId} has exceeded usage limits. Blocking execution.`, {
        currentUsage: usageCheck.currentUsage,
        limit: usageCheck.limit,
        workflowId,
        triggerType,
      })

      await loggingSession.safeStart({
        userId,
        workspaceId: workflow.workspaceId || '',
        variables: {},
      })

      await loggingSession.safeCompleteWithError({
        error: {
          message:
            usageCheck.message || 'Usage limit exceeded. Please upgrade your plan to continue.',
          stackTrace: undefined,
        },
        traceSpans: [],
      })

      return NextResponse.json(
        {
          error:
            usageCheck.message || 'Usage limit exceeded. Please upgrade your plan to continue.',
        },
        { status: 402 }
      )
    }

    // Process file fields in workflow input (base64/URL to UserFile conversion)
    let processedInput = input
    try {
      const workflowData = shouldUseDraftState
        ? await loadWorkflowFromNormalizedTables(workflowId)
        : await loadDeployedWorkflowState(workflowId)

      if (workflowData) {
        const serializedWorkflow = new Serializer().serializeWorkflow(
          workflowData.blocks,
          workflowData.edges,
          workflowData.loops,
          workflowData.parallels,
          false
        )

        const executionContext = {
          workspaceId: workflow.workspaceId || '',
          workflowId,
          executionId,
        }

        processedInput = await processInputFileFields(
          input,
          serializedWorkflow.blocks,
          executionContext,
          requestId,
          userId
        )
      }
    } catch (fileError) {
      logger.error(`[${requestId}] Failed to process input file fields:`, fileError)

      await loggingSession.safeStart({
        userId,
        workspaceId: workflow.workspaceId || '',
        variables: {},
      })

      await loggingSession.safeCompleteWithError({
        error: {
          message: `File processing failed: ${fileError instanceof Error ? fileError.message : 'Unable to process input files'}`,
          stackTrace: fileError instanceof Error ? fileError.stack : undefined,
        },
        traceSpans: [],
      })

      return NextResponse.json(
        {
          error: `File processing failed: ${fileError instanceof Error ? fileError.message : 'Unable to process input files'}`,
        },
        { status: 400 }
      )
    }

    if (!enableSSE) {
      logger.info(`[${requestId}] Using non-SSE execution (direct JSON response)`)
      try {
        const metadata: ExecutionMetadata = {
          requestId,
          executionId,
          workflowId,
          workspaceId: workflow.workspaceId,
          userId,
          triggerType,
          useDraftState: shouldUseDraftState,
          startTime: new Date().toISOString(),
          workflowStateOverride,
        }

        const snapshot = new ExecutionSnapshot(
          metadata,
          workflow,
          processedInput,
          {},
          workflow.variables || {},
          selectedOutputs
        )

        const result = await executeWorkflowCore({
          snapshot,
          callbacks: {},
          loggingSession,
        })

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
        // Block errors are already logged with full details by BlockExecutor
        // Only log the error message here to avoid duplicate logging
        const errorMessage = error.message || 'Unknown error'
        logger.error(`[${requestId}] Non-SSE execution failed: ${errorMessage}`)

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

    if (shouldUseDraftState) {
      logger.info(`[${requestId}] Using SSE console log streaming (manual execution)`)
    } else {
      logger.info(`[${requestId}] Using streaming API response`)
      const deployedData = await loadDeployedWorkflowState(workflowId)
      const resolvedSelectedOutputs = resolveOutputIds(selectedOutputs, deployedData?.blocks || {})
      const stream = await createStreamingResponse({
        requestId,
        workflow,
        input: processedInput,
        executingUserId: userId,
        streamConfig: {
          selectedOutputs: resolvedSelectedOutputs,
          isSecureMode: false,
          workflowTriggerType: triggerType === 'chat' ? 'chat' : 'api',
        },
        createFilteredResult,
        executionId,
      })

      return new NextResponse(stream, {
        status: 200,
        headers: SSE_HEADERS,
      })
    }

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
            isStreamClosed = true
          }
        }

        try {
          const startTime = new Date()

          sendEvent({
            type: 'execution:started',
            timestamp: startTime.toISOString(),
            executionId,
            workflowId,
            data: {
              startTime: startTime.toISOString(),
            },
          })

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

          const metadata: ExecutionMetadata = {
            requestId,
            executionId,
            workflowId,
            workspaceId: workflow.workspaceId,
            userId,
            triggerType,
            useDraftState: shouldUseDraftState,
            startTime: new Date().toISOString(),
            workflowStateOverride,
          }

          const snapshot = new ExecutionSnapshot(
            metadata,
            workflow,
            processedInput,
            {},
            workflow.variables || {},
            selectedOutputs
          )

          const result = await executeWorkflowCore({
            snapshot,
            callbacks: {
              onBlockStart,
              onBlockComplete,
              onStream,
              onExecutorCreated: (executor) => {
                executorInstance = executor
              },
            },
            loggingSession,
          })

          if (result.status === 'paused') {
            if (!result.snapshotSeed) {
              logger.error(`[${requestId}] Missing snapshot seed for paused execution`, {
                executionId,
              })
            } else {
              await PauseResumeManager.persistPauseResult({
                workflowId,
                executionId,
                pausePoints: result.pausePoints || [],
                snapshotSeed: result.snapshotSeed,
                executorUserId: result.metadata?.userId,
              })
            }
          } else {
            await PauseResumeManager.processQueuedResumes(executionId)
          }

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
            return
          }

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
          // Block errors are already logged with full details by BlockExecutor
          // Only log the error message here to avoid duplicate logging
          const errorMessage = error.message || 'Unknown error'
          logger.error(`[${requestId}] SSE execution failed: ${errorMessage}`)

          const executionResult = error.executionResult

          sendEvent({
            type: 'execution:error',
            timestamp: new Date().toISOString(),
            executionId,
            workflowId,
            data: {
              error: executionResult?.error || errorMessage,
              duration: executionResult?.metadata?.duration || 0,
            },
          })
        } finally {
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

        if (executorInstance && typeof executorInstance.cancel === 'function') {
          executorInstance.cancel()
        }
      },
    })

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
