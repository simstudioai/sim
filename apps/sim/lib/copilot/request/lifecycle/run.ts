import { createLogger } from '@sim/logger'
import { updateRunStatus } from '@/lib/copilot/async-runs/repository'
import { SIM_AGENT_API_URL, SIM_AGENT_VERSION } from '@/lib/copilot/constants'
import {
  MothershipStreamV1EventType,
  MothershipStreamV1RunKind,
  MothershipStreamV1ToolOutcome,
} from '@/lib/copilot/generated/mothership-stream-v1'
import { createStreamingContext } from '@/lib/copilot/request/context/request-context'
import { buildToolCallSummaries } from '@/lib/copilot/request/context/result'
import {
  BillingLimitError,
  CopilotBackendError,
  runStreamLoop,
} from '@/lib/copilot/request/go/stream'
import { handleBillingLimitResponse } from '@/lib/copilot/request/tools/billing'
import { executeToolAndReport } from '@/lib/copilot/request/tools/executor'
import type { TraceCollector } from '@/lib/copilot/request/trace'
import { RequestTraceV1SpanStatus } from '@/lib/copilot/request/trace'
import type {
  ExecutionContext,
  OrchestratorOptions,
  OrchestratorResult,
  StreamEvent,
  StreamingContext,
} from '@/lib/copilot/request/types'
import { prepareExecutionContext } from '@/lib/copilot/tools/handlers/context'
import { env } from '@/lib/core/config/env'
import { getEffectiveDecryptedEnv } from '@/lib/environment/utils'

const logger = createLogger('CopilotLifecycle')

const MAX_RESUME_ATTEMPTS = 3
const RESUME_BACKOFF_MS = [250, 500, 1000] as const

export interface CopilotLifecycleOptions extends OrchestratorOptions {
  userId: string
  workflowId?: string
  workspaceId?: string
  chatId?: string
  executionId?: string
  runId?: string
  goRoute?: string
  trace?: TraceCollector
  simRequestId?: string
}

export async function runCopilotLifecycle(
  requestPayload: Record<string, unknown>,
  options: CopilotLifecycleOptions
): Promise<OrchestratorResult> {
  const {
    userId,
    workflowId,
    workspaceId,
    chatId,
    executionId,
    runId,
    goRoute = '/api/copilot',
  } = options

  const execContext = await buildExecutionContext(requestPayload, {
    userId,
    workflowId,
    workspaceId,
    chatId,
    executionId,
    runId,
    abortSignal: options.abortSignal,
  })

  const payloadMsgId = requestPayload?.messageId
  const context = createStreamingContext({
    chatId,
    executionId,
    runId,
    messageId: typeof payloadMsgId === 'string' ? payloadMsgId : crypto.randomUUID(),
    ...(options.trace ? { trace: options.trace } : {}),
  })

  try {
    await runCheckpointLoop(requestPayload, context, execContext, options, goRoute)

    const result: OrchestratorResult = {
      success: context.errors.length === 0 && !context.wasAborted,
      content: context.accumulatedContent,
      contentBlocks: context.contentBlocks,
      toolCalls: buildToolCallSummaries(context),
      chatId: context.chatId,
      requestId: context.requestId,
      errors: context.errors.length ? context.errors : undefined,
      usage: context.usage,
      cost: context.cost,
    }
    await options.onComplete?.(result)
    return result
  } catch (error) {
    const err = error instanceof Error ? error : new Error('Copilot orchestration failed')
    logger.error('Copilot orchestration failed', { error: err.message })
    await options.onError?.(err)
    return {
      success: false,
      content: '',
      contentBlocks: [],
      toolCalls: [],
      chatId: context.chatId,
      error: err.message,
    }
  }
}

// ---------------------------------------------------------------------------
// Checkpoint loop – the core state machine
// ---------------------------------------------------------------------------

async function runCheckpointLoop(
  initialPayload: Record<string, unknown>,
  context: StreamingContext,
  execContext: ExecutionContext,
  options: CopilotLifecycleOptions,
  initialRoute: string
): Promise<void> {
  let route = initialRoute
  let payload: Record<string, unknown> = initialPayload
  let resumeAttempt = 0
  const callerOnEvent = options.onEvent

  for (;;) {
    context.streamComplete = false
    const isResume = route === '/api/tools/resume'

    if (isResume && isAborted(options, context)) {
      cancelPendingTools(context)
      context.awaitingAsyncContinuation = undefined
      break
    }

    const loopOptions = {
      ...options,
      onEvent: async (event: StreamEvent) => {
        if (
          event.type === MothershipStreamV1EventType.run &&
          event.payload.kind === MothershipStreamV1RunKind.checkpoint_pause &&
          options.runId
        ) {
          try {
            await updateRunStatus(options.runId, 'paused_waiting_for_tool')
          } catch (error) {
            logger.warn('Failed to mark run as paused_waiting_for_tool', {
              runId: options.runId,
              error: error instanceof Error ? error.message : String(error),
            })
          }
        }
        await callerOnEvent?.(event)
      },
    }

    const streamSpan = context.trace.startSpan(
      isResume ? 'Sim → Go (Resume)' : 'Sim → Go Stream',
      isResume ? 'lifecycle.resume' : 'sim.stream',
      {
        route,
        isResume,
        ...(isResume ? { attempt: resumeAttempt } : {}),
      }
    )
    context.trace.setActiveSpan(streamSpan)

    logger.info('Starting stream loop', {
      route,
      isResume,
      resumeAttempt,
      pendingToolPromises: context.pendingToolPromises.size,
      toolCallCount: context.toolCalls.size,
      hasCheckpoint: !!context.awaitingAsyncContinuation,
    })

    try {
      await runStreamLoop(
        `${SIM_AGENT_API_URL}${route}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(env.COPILOT_API_KEY ? { 'x-api-key': env.COPILOT_API_KEY } : {}),
            'X-Client-Version': SIM_AGENT_VERSION,
            ...(options.simRequestId ? { 'X-Sim-Request-ID': options.simRequestId } : {}),
          },
          body: JSON.stringify(payload),
        },
        context,
        execContext,
        loopOptions
      )
      context.trace.endSpan(streamSpan)
      resumeAttempt = 0
    } catch (streamError) {
      context.trace.endSpan(streamSpan, RequestTraceV1SpanStatus.error)
      if (streamError instanceof BillingLimitError) {
        await handleBillingLimitResponse(streamError.userId, context, execContext, options)
        break
      }
      if (
        isResume &&
        isRetryableStreamError(streamError) &&
        resumeAttempt < MAX_RESUME_ATTEMPTS - 1
      ) {
        resumeAttempt++
        const backoff = RESUME_BACKOFF_MS[resumeAttempt - 1] ?? 1000
        logger.warn('Resume stream failed, retrying', {
          attempt: resumeAttempt + 1,
          maxAttempts: MAX_RESUME_ATTEMPTS,
          backoffMs: backoff,
          error: streamError instanceof Error ? streamError.message : String(streamError),
        })
        await sleepWithAbort(backoff, options.abortSignal)
        continue
      }
      throw streamError
    }

    logger.info('Stream loop completed', {
      route,
      isResume,
      isAborted: isAborted(options, context),
      hasCheckpoint: !!context.awaitingAsyncContinuation,
      checkpointId: context.awaitingAsyncContinuation?.checkpointId,
      pendingToolPromises: context.pendingToolPromises.size,
      streamComplete: context.streamComplete,
      toolCallCount: context.toolCalls.size,
    })

    if (isAborted(options, context)) {
      cancelPendingTools(context)
      context.awaitingAsyncContinuation = undefined
      break
    }

    const continuation = context.awaitingAsyncContinuation
    if (!continuation) break

    if (context.pendingToolPromises.size > 0) {
      const waitSpan = context.trace.startSpan('Wait for Tools', 'lifecycle.wait_tools', {
        checkpointId: continuation.checkpointId,
        pendingCount: context.pendingToolPromises.size,
      })
      logger.info('Waiting for in-flight tool executions before resume', {
        checkpointId: continuation.checkpointId,
        pendingCount: context.pendingToolPromises.size,
      })
      await Promise.allSettled(context.pendingToolPromises.values())
      context.trace.endSpan(waitSpan)
    }

    if (isAborted(options, context)) {
      cancelPendingTools(context)
      context.awaitingAsyncContinuation = undefined
      break
    }

    const undispatchedToolIds = continuation.pendingToolCallIds.filter((toolCallId) => {
      const tool = context.toolCalls.get(toolCallId)
      return (
        !!tool &&
        !tool.result &&
        !tool.error &&
        !context.pendingToolPromises.has(toolCallId) &&
        tool.status !== 'executing'
      )
    })

    if (undispatchedToolIds.length > 0) {
      logger.warn('Checkpointed tools were never dispatched; executing before resume', {
        checkpointId: continuation.checkpointId,
        toolCallIds: undispatchedToolIds,
      })
      await Promise.allSettled(
        undispatchedToolIds.map((toolCallId) =>
          executeToolAndReport(toolCallId, context, execContext, options)
        )
      )
    }

    const results: Array<{
      callId: string
      name: string
      data: unknown
      success: boolean
    }> = []
    for (const toolCallId of continuation.pendingToolCallIds) {
      const tool = context.toolCalls.get(toolCallId)
      if (!tool || (!tool.result && !tool.error)) {
        logger.error('Missing tool result for pending tool call', {
          toolCallId,
          checkpointId: continuation.checkpointId,
          hasToolEntry: !!tool,
          toolName: tool?.name,
          toolStatus: tool?.status,
          hasPendingPromise: context.pendingToolPromises.has(toolCallId),
        })
        throw new Error(`Cannot resume: missing result for pending tool call ${toolCallId}`)
      }
      results.push({
        callId: toolCallId,
        name: tool.name || '',
        data: tool.result?.output ?? (tool.error ? { error: tool.error } : { error: 'unknown' }),
        success: tool.result?.success ?? false,
      })
    }

    logger.info('Resuming with tool results', {
      checkpointId: continuation.checkpointId,
      runId: continuation.runId,
      toolCount: results.length,
      pendingToolCallIds: continuation.pendingToolCallIds,
      frameCount: continuation.frames?.length ?? 0,
    })

    context.awaitingAsyncContinuation = undefined
    route = '/api/tools/resume'
    payload = {
      streamId: context.messageId,
      checkpointId: continuation.checkpointId,
      results,
    }
    logger.info('Prepared resume request payload', {
      route,
      streamId: context.messageId,
      checkpointId: continuation.checkpointId,
      resultCount: results.length,
    })
  }
}

// ---------------------------------------------------------------------------
// Execution context builder
// ---------------------------------------------------------------------------

async function buildExecutionContext(
  requestPayload: Record<string, unknown>,
  params: {
    userId: string
    workflowId?: string
    workspaceId?: string
    chatId?: string
    executionId?: string
    runId?: string
    abortSignal?: AbortSignal
  }
): Promise<ExecutionContext> {
  const { userId, workflowId, workspaceId, chatId, executionId, runId, abortSignal } = params
  const userTimezone =
    typeof requestPayload?.userTimezone === 'string' ? requestPayload.userTimezone : undefined

  let execContext: ExecutionContext
  if (workflowId) {
    execContext = await prepareExecutionContext(userId, workflowId, chatId)
  } else {
    const decryptedEnvVars = await getEffectiveDecryptedEnv(userId, workspaceId)
    execContext = {
      userId,
      workflowId: '',
      workspaceId,
      chatId,
      decryptedEnvVars,
    }
  }

  if (userTimezone) execContext.userTimezone = userTimezone
  execContext.executionId = executionId
  execContext.runId = runId
  execContext.abortSignal = abortSignal
  return execContext
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isAborted(options: CopilotLifecycleOptions, context: StreamingContext): boolean {
  return !!(options.abortSignal?.aborted || context.wasAborted)
}

function cancelPendingTools(context: StreamingContext): void {
  for (const [, toolCall] of context.toolCalls) {
    if (toolCall.status === 'pending' || toolCall.status === 'executing') {
      toolCall.status = MothershipStreamV1ToolOutcome.cancelled
      toolCall.endTime = Date.now()
      toolCall.error = 'Stopped by user'
    }
  }
}

function isRetryableStreamError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return false
  }
  if (error instanceof CopilotBackendError) {
    return error.status !== undefined && error.status >= 500
  }
  if (error instanceof TypeError) {
    return true
  }
  return false
}

function sleepWithAbort(ms: number, abortSignal?: AbortSignal): Promise<void> {
  if (!abortSignal) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
  if (abortSignal.aborted) {
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      abortSignal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timeoutId)
      abortSignal.removeEventListener('abort', onAbort)
      resolve()
    }
    abortSignal.addEventListener('abort', onAbort, { once: true })
  })
}
