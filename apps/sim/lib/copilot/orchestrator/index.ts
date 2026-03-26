import { createLogger } from '@sim/logger'
import { updateRunStatus } from '@/lib/copilot/async-runs/repository'
import { SIM_AGENT_API_URL, SIM_AGENT_VERSION } from '@/lib/copilot/constants'
import {
  MothershipStreamV1EventType,
  MothershipStreamV1RunKind,
} from '@/lib/copilot/generated/mothership-stream-v1'
import { prepareExecutionContext } from '@/lib/copilot/orchestrator/tool-executor'
import type {
  ExecutionContext,
  OrchestratorOptions,
  OrchestratorResult,
  StreamEvent,
} from '@/lib/copilot/orchestrator/types'
import { env } from '@/lib/core/config/env'
import { getEffectiveDecryptedEnv } from '@/lib/environment/utils'
import {
  buildToolCallSummaries,
  CopilotBackendError,
  createStreamingContext,
  runStreamLoop,
} from './stream/core'

const logger = createLogger('CopilotOrchestrator')

const MAX_RESUME_ATTEMPTS = 3
const RESUME_BACKOFF_MS = [250, 500, 1000]

export interface OrchestrateStreamOptions extends OrchestratorOptions {
  userId: string
  workflowId?: string
  workspaceId?: string
  chatId?: string
  executionId?: string
  runId?: string
  goRoute?: string
}

export async function orchestrateCopilotStream(
  requestPayload: Record<string, unknown>,
  options: OrchestrateStreamOptions
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
  execContext.abortSignal = options.abortSignal
  execContext.userStopSignal = options.userStopSignal

  const payloadMsgId = requestPayload?.messageId
  const context = createStreamingContext({
    chatId,
    executionId,
    runId,
    messageId: typeof payloadMsgId === 'string' ? payloadMsgId : crypto.randomUUID(),
  })

  try {
    let route = goRoute
    let payload: Record<string, unknown> = requestPayload

    const callerOnEvent = options.onEvent

    let resumeAttempt = 0

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
            runId
          ) {
            await updateRunStatus(runId, 'paused_waiting_for_tool').catch(() => {})
          }
          await callerOnEvent?.(event)
        },
      }

      try {
        await runStreamLoop(
          `${SIM_AGENT_API_URL}${route}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(env.COPILOT_API_KEY ? { 'x-api-key': env.COPILOT_API_KEY } : {}),
              'X-Client-Version': SIM_AGENT_VERSION,
            },
            body: JSON.stringify(payload),
          },
          context,
          execContext,
          loopOptions
        )
        resumeAttempt = 0
      } catch (streamError) {
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

      if (isAborted(options, context)) {
        cancelPendingTools(context)
        context.awaitingAsyncContinuation = undefined
        break
      }

      const continuation = context.awaitingAsyncContinuation
      if (!continuation) break

      if (context.pendingToolPromises.size > 0) {
        logger.info('Waiting for in-flight tool executions before resume', {
          checkpointId: continuation.checkpointId,
          pendingCount: context.pendingToolPromises.size,
        })
        await Promise.allSettled(context.pendingToolPromises.values())
      }

      if (isAborted(options, context)) {
        cancelPendingTools(context)
        context.awaitingAsyncContinuation = undefined
        break
      }

      const results = continuation.pendingToolCallIds.map((toolCallId) => {
        const tool = context.toolCalls.get(toolCallId)
        return {
          callId: toolCallId,
          name: tool?.name || '',
          data:
            tool?.result?.output ??
            (tool?.error ? { error: tool.error } : { message: 'Tool completed' }),
          success: tool?.result?.success ?? false,
        }
      })

      logger.info('Resuming with tool results', {
        checkpointId: continuation.checkpointId,
        runId: continuation.runId,
        toolCount: results.length,
      })

      context.awaitingAsyncContinuation = undefined
      route = '/api/tools/resume'
      payload = {
        streamId: context.messageId,
        checkpointId: continuation.checkpointId,
        results,
      }
    }

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

function isAborted(
  options: OrchestrateStreamOptions,
  context: ReturnType<typeof createStreamingContext>
): boolean {
  return !!(options.abortSignal?.aborted || context.wasAborted)
}

function cancelPendingTools(context: ReturnType<typeof createStreamingContext>): void {
  for (const [, toolCall] of context.toolCalls) {
    if (toolCall.status === 'pending' || toolCall.status === 'executing') {
      toolCall.status = 'cancelled'
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
