import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { validate as uuidValidate, v4 as uuidv4 } from 'uuid'
import { z } from 'zod'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { getJobQueue, shouldExecuteInline } from '@/lib/core/async-jobs'
import {
  createTimeoutAbortController,
  getTimeoutErrorMessage,
  isTimeoutError,
} from '@/lib/core/execution-limits'
import { generateRequestId } from '@/lib/core/utils/request'
import { SSE_HEADERS } from '@/lib/core/utils/sse'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { markExecutionCancelled } from '@/lib/execution/cancellation'
import { processInputFileFields } from '@/lib/execution/files'
import { preprocessExecution } from '@/lib/execution/preprocessing'
import { LoggingSession } from '@/lib/logs/execution/logging-session'
import { buildTraceSpans } from '@/lib/logs/execution/trace-spans/trace-spans'
import {
  cleanupExecutionBase64Cache,
  hydrateUserFilesWithBase64,
} from '@/lib/uploads/utils/user-file-base64.server'
import { executeWorkflowCore } from '@/lib/workflows/executor/execution-core'
import { type ExecutionEvent, encodeSSEEvent } from '@/lib/workflows/executor/execution-events'
import { PauseResumeManager } from '@/lib/workflows/executor/human-in-the-loop-manager'
import {
  loadDeployedWorkflowState,
  loadWorkflowFromNormalizedTables,
} from '@/lib/workflows/persistence/utils'
import { createStreamingResponse } from '@/lib/workflows/streaming/streaming'
import { createHttpResponseFromBlock, workflowHasResponseBlock } from '@/lib/workflows/utils'
import { executeWorkflowJob, type WorkflowExecutionPayload } from '@/background/workflow-execution'
import { normalizeName } from '@/executor/constants'
import { ExecutionSnapshot } from '@/executor/execution/snapshot'
import type { ExecutionMetadata, IterationContext } from '@/executor/execution/types'
import type { NormalizedBlockOutput, StreamingExecution } from '@/executor/types'
import { hasExecutionResult } from '@/executor/utils/errors'
import { Serializer } from '@/serializer'
import { CORE_TRIGGER_TYPES, type CoreTriggerType } from '@/stores/logs/filters/types'

const logger = createLogger('WorkflowExecuteAPI')

const ExecuteWorkflowSchema = z.object({
  selectedOutputs: z.array(z.string()).optional().default([]),
  triggerType: z.enum(CORE_TRIGGER_TYPES).optional(),
  stream: z.boolean().optional(),
  useDraftState: z.boolean().optional(),
  input: z.any().optional(),
  isClientSession: z.boolean().optional(),
  includeFileBase64: z.boolean().optional().default(true),
  base64MaxBytes: z.number().int().positive().optional(),
  workflowStateOverride: z
    .object({
      blocks: z.record(z.any()),
      edges: z.array(z.any()),
      loops: z.record(z.any()).optional(),
      parallels: z.record(z.any()).optional(),
    })
    .optional(),
  stopAfterBlockId: z.string().optional(),
  runFromBlock: z
    .object({
      startBlockId: z.string().min(1, 'Start block ID is required'),
      sourceSnapshot: z.object({
        blockStates: z.record(z.any()),
        executedBlocks: z.array(z.string()),
        blockLogs: z.array(z.any()),
        decisions: z.object({
          router: z.record(z.string()),
          condition: z.record(z.string()),
        }),
        completedLoops: z.array(z.string()),
        loopExecutions: z.record(z.any()).optional(),
        parallelExecutions: z.record(z.any()).optional(),
        parallelBlockMapping: z.record(z.any()).optional(),
        activeExecutionPath: z.array(z.string()),
      }),
    })
    .optional(),
})

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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

    const normalizedBlockName = normalizeName(blockName)
    const block = Object.values(blocks).find((b: any) => {
      return normalizeName(b.name || '') === normalizedBlockName
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

type AsyncExecutionParams = {
  requestId: string
  workflowId: string
  userId: string
  input: any
  triggerType: CoreTriggerType
  executionId: string
}

async function handleAsyncExecution(params: AsyncExecutionParams): Promise<NextResponse> {
  const { requestId, workflowId, userId, input, triggerType, executionId } = params

  const payload: WorkflowExecutionPayload = {
    workflowId,
    userId,
    input,
    triggerType,
    executionId,
  }

  try {
    const jobQueue = await getJobQueue()
    const jobId = await jobQueue.enqueue('workflow-execution', payload, {
      metadata: { workflowId, userId },
    })

    logger.info(`[${requestId}] Queued async workflow execution`, {
      workflowId,
      jobId,
    })

    if (shouldExecuteInline()) {
      void (async () => {
        try {
          await jobQueue.startJob(jobId)
          const output = await executeWorkflowJob(payload)
          await jobQueue.completeJob(jobId, output)
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error)
          logger.error(`[${requestId}] Async workflow execution failed`, {
            jobId,
            error: errorMessage,
          })
          try {
            await jobQueue.markJobFailed(jobId, errorMessage)
          } catch (markFailedError) {
            logger.error(`[${requestId}] Failed to mark job as failed`, {
              jobId,
              error:
                markFailedError instanceof Error
                  ? markFailedError.message
                  : String(markFailedError),
            })
          }
        }
      })()
    }

    return NextResponse.json(
      {
        success: true,
        async: true,
        jobId,
        executionId,
        message: 'Workflow execution queued',
        statusUrl: `${getBaseUrl()}/api/jobs/${jobId}`,
      },
      { status: 202 }
    )
  } catch (error: any) {
    logger.error(`[${requestId}] Failed to queue async execution`, error)
    return NextResponse.json(
      { error: `Failed to queue async execution: ${error.message}` },
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
    const auth = await checkHybridAuth(req, { requireWorkflowId: false })
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }
    const userId = auth.userId

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
      isClientSession = false,
      includeFileBase64,
      base64MaxBytes,
      workflowStateOverride,
      stopAfterBlockId,
      runFromBlock,
    } = validation.data

    // For API key and internal JWT auth, the entire body is the input (except for our control fields)
    // For session auth, the input is explicitly provided in the input field
    const input =
      auth.authType === 'api_key' || auth.authType === 'internal_jwt'
        ? (() => {
            const {
              selectedOutputs,
              triggerType,
              stream,
              useDraftState,
              includeFileBase64,
              base64MaxBytes,
              workflowStateOverride,
              stopAfterBlockId: _stopAfterBlockId,
              runFromBlock: _runFromBlock,
              workflowId: _workflowId, // Also exclude workflowId used for internal JWT auth
              ...rest
            } = body
            return Object.keys(rest).length > 0 ? rest : validatedInput
          })()
        : validatedInput

    const shouldUseDraftState = useDraftState ?? auth.authType === 'session'

    const streamHeader = req.headers.get('X-Stream-Response') === 'true'
    const enableSSE = streamHeader || streamParam === true
    const executionModeHeader = req.headers.get('X-Execution-Mode')
    const isAsyncMode = executionModeHeader === 'async'

    logger.info(`[${requestId}] Starting server-side execution`, {
      workflowId,
      userId,
      hasInput: !!input,
      triggerType,
      authType: auth.authType,
      streamParam,
      streamHeader,
      enableSSE,
      isAsyncMode,
    })

    const executionId = uuidv4()
    let loggingTriggerType: CoreTriggerType = 'manual'
    if (CORE_TRIGGER_TYPES.includes(triggerType as CoreTriggerType)) {
      loggingTriggerType = triggerType as CoreTriggerType
    }
    const loggingSession = new LoggingSession(
      workflowId,
      executionId,
      loggingTriggerType,
      requestId
    )

    // Client-side sessions and personal API keys bill/permission-check the
    // authenticated user, not the workspace billed account.
    const useAuthenticatedUserAsActor =
      isClientSession || (auth.authType === 'api_key' && auth.apiKeyType === 'personal')

    const preprocessResult = await preprocessExecution({
      workflowId,
      userId,
      triggerType: loggingTriggerType,
      executionId,
      requestId,
      checkDeployment: !shouldUseDraftState,
      loggingSession,
      useDraftState: shouldUseDraftState,
      useAuthenticatedUserAsActor,
    })

    if (!preprocessResult.success) {
      return NextResponse.json(
        { error: preprocessResult.error!.message },
        { status: preprocessResult.error!.statusCode }
      )
    }

    const actorUserId = preprocessResult.actorUserId!
    const workflow = preprocessResult.workflowRecord!

    if (!workflow.workspaceId) {
      logger.error(`[${requestId}] Workflow ${workflowId} has no workspaceId`)
      return NextResponse.json({ error: 'Workflow has no associated workspace' }, { status: 500 })
    }
    const workspaceId = workflow.workspaceId

    logger.info(`[${requestId}] Preprocessing passed`, {
      workflowId,
      actorUserId,
      workspaceId,
    })

    if (isAsyncMode) {
      return handleAsyncExecution({
        requestId,
        workflowId,
        userId: actorUserId,
        input,
        triggerType: loggingTriggerType,
        executionId,
      })
    }

    let cachedWorkflowData: {
      blocks: Record<string, any>
      edges: any[]
      loops: Record<string, any>
      parallels: Record<string, any>
      deploymentVersionId?: string
      variables?: Record<string, any>
    } | null = null

    let processedInput = input
    try {
      const workflowData = shouldUseDraftState
        ? await loadWorkflowFromNormalizedTables(workflowId)
        : await loadDeployedWorkflowState(workflowId)

      if (workflowData) {
        const deployedVariables =
          !shouldUseDraftState && 'variables' in workflowData
            ? (workflowData as any).variables
            : undefined

        cachedWorkflowData = {
          blocks: workflowData.blocks,
          edges: workflowData.edges,
          loops: workflowData.loops || {},
          parallels: workflowData.parallels || {},
          deploymentVersionId:
            !shouldUseDraftState && 'deploymentVersionId' in workflowData
              ? (workflowData.deploymentVersionId as string)
              : undefined,
          variables: deployedVariables,
        }

        const serializedWorkflow = new Serializer().serializeWorkflow(
          workflowData.blocks,
          workflowData.edges,
          workflowData.loops,
          workflowData.parallels,
          false
        )

        const executionContext = {
          workspaceId,
          workflowId,
          executionId,
        }

        processedInput = await processInputFileFields(
          input,
          serializedWorkflow.blocks,
          executionContext,
          requestId,
          actorUserId
        )
      }
    } catch (fileError) {
      logger.error(`[${requestId}] Failed to process input file fields:`, fileError)

      await loggingSession.safeStart({
        userId: actorUserId,
        workspaceId,
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

    const effectiveWorkflowStateOverride = workflowStateOverride || cachedWorkflowData || undefined

    if (!enableSSE) {
      logger.info(`[${requestId}] Using non-SSE execution (direct JSON response)`)
      const timeoutController = createTimeoutAbortController(
        preprocessResult.executionTimeout?.sync
      )

      try {
        const metadata: ExecutionMetadata = {
          requestId,
          executionId,
          workflowId,
          workspaceId,
          userId: actorUserId,
          sessionUserId: isClientSession ? userId : undefined,
          workflowUserId: workflow.userId,
          triggerType,
          useDraftState: shouldUseDraftState,
          startTime: new Date().toISOString(),
          isClientSession,
          workflowStateOverride: effectiveWorkflowStateOverride,
        }

        const executionVariables = cachedWorkflowData?.variables ?? workflow.variables ?? {}

        const snapshot = new ExecutionSnapshot(
          metadata,
          workflow,
          processedInput,
          executionVariables,
          selectedOutputs
        )

        const result = await executeWorkflowCore({
          snapshot,
          callbacks: {},
          loggingSession,
          includeFileBase64,
          base64MaxBytes,
          stopAfterBlockId,
          runFromBlock,
          abortSignal: timeoutController.signal,
        })

        if (
          result.status === 'cancelled' &&
          timeoutController.isTimedOut() &&
          timeoutController.timeoutMs
        ) {
          const timeoutErrorMessage = getTimeoutErrorMessage(null, timeoutController.timeoutMs)
          logger.info(`[${requestId}] Non-SSE execution timed out`, {
            timeoutMs: timeoutController.timeoutMs,
          })
          await loggingSession.markAsFailed(timeoutErrorMessage)

          return NextResponse.json(
            {
              success: false,
              output: result.output,
              error: timeoutErrorMessage,
              metadata: result.metadata
                ? {
                    duration: result.metadata.duration,
                    startTime: result.metadata.startTime,
                    endTime: result.metadata.endTime,
                  }
                : undefined,
            },
            { status: 408 }
          )
        }

        const outputWithBase64 = includeFileBase64
          ? ((await hydrateUserFilesWithBase64(result.output, {
              requestId,
              executionId,
              maxBytes: base64MaxBytes,
            })) as NormalizedBlockOutput)
          : result.output

        const resultWithBase64 = { ...result, output: outputWithBase64 }

        const hasResponseBlock = workflowHasResponseBlock(resultWithBase64)
        if (hasResponseBlock) {
          return createHttpResponseFromBlock(resultWithBase64)
        }

        const filteredResult = {
          success: result.success,
          executionId,
          output: outputWithBase64,
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
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'

        logger.error(`[${requestId}] Non-SSE execution failed: ${errorMessage}`)

        const executionResult = hasExecutionResult(error) ? error.executionResult : undefined

        await loggingSession.safeCompleteWithError({
          totalDurationMs: executionResult?.metadata?.duration,
          error: { message: errorMessage },
          traceSpans: executionResult?.logs as any,
        })

        return NextResponse.json(
          {
            success: false,
            output: executionResult?.output,
            error: executionResult?.error || errorMessage || 'Execution failed',
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
      } finally {
        timeoutController.cleanup()
        if (executionId) {
          try {
            await cleanupExecutionBase64Cache(executionId)
          } catch (error) {
            logger.error(`[${requestId}] Failed to cleanup base64 cache`, { error })
          }
        }
      }
    }

    if (shouldUseDraftState) {
      logger.info(`[${requestId}] Using SSE console log streaming (manual execution)`)
    } else {
      logger.info(`[${requestId}] Using streaming API response`)

      const resolvedSelectedOutputs = resolveOutputIds(
        selectedOutputs,
        cachedWorkflowData?.blocks || {}
      )
      const streamVariables = cachedWorkflowData?.variables ?? (workflow as any).variables
      const stream = await createStreamingResponse({
        requestId,
        workflow: {
          id: workflow.id,
          userId: actorUserId,
          workspaceId,
          isDeployed: workflow.isDeployed,
          variables: streamVariables,
        },
        input: processedInput,
        executingUserId: actorUserId,
        streamConfig: {
          selectedOutputs: resolvedSelectedOutputs,
          isSecureMode: false,
          workflowTriggerType: triggerType === 'chat' ? 'chat' : 'api',
          includeFileBase64,
          base64MaxBytes,
          timeoutMs: preprocessResult.executionTimeout?.sync,
        },
        executionId,
      })

      return new NextResponse(stream, {
        status: 200,
        headers: SSE_HEADERS,
      })
    }

    const encoder = new TextEncoder()
    const timeoutController = createTimeoutAbortController(preprocessResult.executionTimeout?.sync)
    let isStreamClosed = false

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const sendEvent = (event: ExecutionEvent) => {
          if (isStreamClosed) return

          try {
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
            executionOrder: number,
            iterationContext?: IterationContext
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
                executionOrder,
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
            iterationContext?: IterationContext
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
                  startedAt: callbackData.startedAt,
                  executionOrder: callbackData.executionOrder,
                  endedAt: callbackData.endedAt,
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
                  startedAt: callbackData.startedAt,
                  executionOrder: callbackData.executionOrder,
                  endedAt: callbackData.endedAt,
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
            let chunkCount = 0

            try {
              while (true) {
                const { done, value } = await reader.read()
                if (done) break

                chunkCount++
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
            workspaceId,
            userId: actorUserId,
            sessionUserId: isClientSession ? userId : undefined,
            workflowUserId: workflow.userId,
            triggerType,
            useDraftState: shouldUseDraftState,
            startTime: new Date().toISOString(),
            isClientSession,
            workflowStateOverride: effectiveWorkflowStateOverride,
          }

          const sseExecutionVariables = cachedWorkflowData?.variables ?? workflow.variables ?? {}

          const snapshot = new ExecutionSnapshot(
            metadata,
            workflow,
            processedInput,
            sseExecutionVariables,
            selectedOutputs
          )

          const result = await executeWorkflowCore({
            snapshot,
            callbacks: {
              onBlockStart,
              onBlockComplete,
              onStream,
            },
            loggingSession,
            abortSignal: timeoutController.signal,
            includeFileBase64,
            base64MaxBytes,
            stopAfterBlockId,
            runFromBlock,
          })

          if (result.status === 'paused') {
            if (!result.snapshotSeed) {
              logger.error(`[${requestId}] Missing snapshot seed for paused execution`, {
                executionId,
              })
              await loggingSession.markAsFailed('Missing snapshot seed for paused execution')
            } else {
              try {
                await PauseResumeManager.persistPauseResult({
                  workflowId,
                  executionId,
                  pausePoints: result.pausePoints || [],
                  snapshotSeed: result.snapshotSeed,
                  executorUserId: result.metadata?.userId,
                })
              } catch (pauseError) {
                logger.error(`[${requestId}] Failed to persist pause result`, {
                  executionId,
                  error: pauseError instanceof Error ? pauseError.message : String(pauseError),
                })
                await loggingSession.markAsFailed(
                  `Failed to persist pause state: ${pauseError instanceof Error ? pauseError.message : String(pauseError)}`
                )
              }
            }
          } else {
            await PauseResumeManager.processQueuedResumes(executionId)
          }

          if (result.status === 'cancelled') {
            if (timeoutController.isTimedOut() && timeoutController.timeoutMs) {
              const timeoutErrorMessage = getTimeoutErrorMessage(null, timeoutController.timeoutMs)
              logger.info(`[${requestId}] Workflow execution timed out`, {
                timeoutMs: timeoutController.timeoutMs,
              })

              await loggingSession.markAsFailed(timeoutErrorMessage)

              sendEvent({
                type: 'execution:error',
                timestamp: new Date().toISOString(),
                executionId,
                workflowId,
                data: {
                  error: timeoutErrorMessage,
                  duration: result.metadata?.duration || 0,
                },
              })
            } else {
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
            }
            return
          }

          sendEvent({
            type: 'execution:completed',
            timestamp: new Date().toISOString(),
            executionId,
            workflowId,
            data: {
              success: result.success,
              output: includeFileBase64
                ? await hydrateUserFilesWithBase64(result.output, {
                    requestId,
                    executionId,
                    maxBytes: base64MaxBytes,
                  })
                : result.output,
              duration: result.metadata?.duration || 0,
              startTime: result.metadata?.startTime || startTime.toISOString(),
              endTime: result.metadata?.endTime || new Date().toISOString(),
            },
          })
        } catch (error: unknown) {
          const isTimeout = isTimeoutError(error) || timeoutController.isTimedOut()
          const errorMessage = isTimeout
            ? getTimeoutErrorMessage(error, timeoutController.timeoutMs)
            : error instanceof Error
              ? error.message
              : 'Unknown error'

          logger.error(`[${requestId}] SSE execution failed: ${errorMessage}`, { isTimeout })

          const executionResult = hasExecutionResult(error) ? error.executionResult : undefined
          const { traceSpans, totalDuration } = executionResult
            ? buildTraceSpans(executionResult)
            : { traceSpans: [], totalDuration: 0 }

          await loggingSession.safeCompleteWithError({
            totalDurationMs: totalDuration || executionResult?.metadata?.duration,
            error: { message: errorMessage },
            traceSpans,
          })

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
          timeoutController.cleanup()
          if (executionId) {
            await cleanupExecutionBase64Cache(executionId)
          }
          if (!isStreamClosed) {
            try {
              controller.enqueue(encoder.encode('data: [DONE]\n\n'))
              controller.close()
            } catch {}
          }
        }
      },
      cancel() {
        isStreamClosed = true
        timeoutController.cleanup()
        logger.info(`[${requestId}] Client aborted SSE stream, signalling cancellation`)
        timeoutController.abort()
        markExecutionCancelled(executionId).catch(() => {})
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
