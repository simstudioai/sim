import { createLogger } from '@sim/logger'
import { updateRunStatus } from '@/lib/copilot/async-runs/repository'
import { SIM_AGENT_API_URL, SIM_AGENT_VERSION } from '@/lib/copilot/constants'
import { prepareExecutionContext } from '@/lib/copilot/orchestrator/tool-executor'
import type {
  ExecutionContext,
  OrchestratorOptions,
  OrchestratorResult,
  SSEEvent,
} from '@/lib/copilot/orchestrator/types'
import { env } from '@/lib/core/config/env'
import { getEffectiveDecryptedEnv } from '@/lib/environment/utils'
import { buildToolCallSummaries, createStreamingContext, runStreamLoop } from './stream/core'

const logger = createLogger('CopilotOrchestrator')
const CHECKPOINT_READY_MAX_ATTEMPTS = 40
const CHECKPOINT_READY_RETRY_MS = 250
const RESUME_UPSTREAM_MAX_ATTEMPTS = 3
const RESUME_UPSTREAM_RETRY_MS = 500
const ASYNC_RESUME_DIAG_TAG = '[ASYNC_RESUME_DIAG]'

interface CheckpointReadyResponse {
  success?: boolean
  checkpointId?: string
  runId?: string
  resumeState?: string
  ready?: boolean
  pendingCallIds?: string[]
  missingCallIds?: string[]
  error?: string
  code?: string
  retryable?: boolean
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isRetryableResumeUpstreamError(route: string, error: unknown): boolean {
  if (route !== '/api/tools/resume') return false
  const message = error instanceof Error ? error.message : String(error)
  return (
    message.includes('Copilot backend error (502)') ||
    message.includes('Copilot backend error (503)') ||
    message.includes('Copilot backend error (504)') ||
    message.includes('fetch failed')
  )
}

async function waitForCheckpointReady(
  checkpointId: string,
  abortSignal?: AbortSignal
): Promise<CheckpointReadyResponse> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (env.COPILOT_API_KEY) {
    headers['x-api-key'] = env.COPILOT_API_KEY
  }

  for (let attempt = 1; attempt <= CHECKPOINT_READY_MAX_ATTEMPTS; attempt++) {
    if (abortSignal?.aborted) {
      return {
        checkpointId,
        ready: false,
        error: 'Request aborted while waiting for checkpoint readiness',
        retryable: true,
      }
    }
    try {
      const response = await fetch(
        `${SIM_AGENT_API_URL}/api/tools/checkpoint-status?checkpointId=${encodeURIComponent(checkpointId)}`,
        {
          method: 'GET',
          headers,
          signal: abortSignal,
        }
      )
      const body = (await response.json().catch(() => ({}))) as CheckpointReadyResponse
      if (!response.ok) {
        return {
          checkpointId,
          ready: false,
          error: body.error || `Checkpoint readiness request failed: ${response.status}`,
          code: body.code,
          retryable: body.retryable ?? response.status >= 500,
          missingCallIds: body.missingCallIds,
        }
      }
      if (body.ready) {
        logger.warn(ASYNC_RESUME_DIAG_TAG, {
          phase: 'checkpoint_ready',
          checkpointId,
          attempt,
          runId: body.runId,
          pendingCallIds: body.pendingCallIds,
        })
        return body
      }
      if (attempt < CHECKPOINT_READY_MAX_ATTEMPTS) {
        await sleep(CHECKPOINT_READY_RETRY_MS * attempt)
        continue
      }
      return body
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return {
          checkpointId,
          ready: false,
          error: 'Request aborted while waiting for checkpoint readiness',
          retryable: true,
        }
      }
      if (attempt < CHECKPOINT_READY_MAX_ATTEMPTS) {
        await sleep(CHECKPOINT_READY_RETRY_MS * attempt)
        continue
      }
      return {
        checkpointId,
        ready: false,
        error: error instanceof Error ? error.message : 'Checkpoint readiness request failed',
        retryable: true,
      }
    }
  }

  return {
    checkpointId,
    ready: false,
    error: 'Checkpoint did not become ready in time',
    retryable: true,
  }
}

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
  if (userTimezone) {
    execContext.userTimezone = userTimezone
  }
  execContext.executionId = executionId
  execContext.runId = runId
  execContext.abortSignal = options.abortSignal

  const payloadMsgId = requestPayload?.messageId
  const context = createStreamingContext({
    chatId,
    executionId,
    runId,
    messageId: typeof payloadMsgId === 'string' ? payloadMsgId : crypto.randomUUID(),
  })

  try {
    let route = goRoute
    let payload = requestPayload

    const callerOnEvent = options.onEvent

    for (;;) {
      context.streamComplete = false

      const loopOptions = {
        ...options,
        onEvent: async (event: SSEEvent) => {
          if (event.type === 'done') {
            const d = (event.data ?? {}) as Record<string, unknown>
            const response = (d.response ?? {}) as Record<string, unknown>
            if (response.async_pause && runId) {
              await updateRunStatus(runId, 'paused_waiting_for_tool').catch(() => {})
            }
          }
          await callerOnEvent?.(event)
        },
      }

      const fetchUrl = `${SIM_AGENT_API_URL}${route}`
      const fetchOptions: RequestInit = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(env.COPILOT_API_KEY ? { 'x-api-key': env.COPILOT_API_KEY } : {}),
          'X-Client-Version': SIM_AGENT_VERSION,
        },
        body: JSON.stringify(payload),
      }

      let streamCompleted = false
      for (
        let resumeAttempt = 1;
        resumeAttempt <= (route === '/api/tools/resume' ? RESUME_UPSTREAM_MAX_ATTEMPTS : 1);
        resumeAttempt++
      ) {
        try {
          await runStreamLoop(fetchUrl, fetchOptions, context, execContext, loopOptions)
          streamCompleted = true
          break
        } catch (error) {
          if (
            !isRetryableResumeUpstreamError(route, error) ||
            resumeAttempt >= RESUME_UPSTREAM_MAX_ATTEMPTS ||
            options.abortSignal?.aborted
          ) {
            throw error
          }

          logger.warn('[COPILOT_UPSTREAM_DIAG] retrying resume after upstream failure', {
            checkpointId:
              route === '/api/tools/resume' &&
              payload &&
              typeof payload === 'object' &&
              'checkpointId' in payload
                ? payload.checkpointId
                : undefined,
            route,
            attempt: resumeAttempt,
            maxAttempts: RESUME_UPSTREAM_MAX_ATTEMPTS,
            error: error instanceof Error ? error.message : String(error),
          })
          await sleep(RESUME_UPSTREAM_RETRY_MS * resumeAttempt)
        }
      }
      if (!streamCompleted) {
        throw new Error(`Failed to complete stream loop for route ${route}`)
      }

      if (options.abortSignal?.aborted || context.wasAborted) {
        for (const [toolCallId, toolCall] of context.toolCalls) {
          if (toolCall.status === 'pending' || toolCall.status === 'executing') {
            toolCall.status = 'cancelled'
            toolCall.endTime = Date.now()
            toolCall.error = 'Stopped by user'
          }
        }
        context.awaitingAsyncContinuation = undefined
        break
      }

      const continuation = context.awaitingAsyncContinuation
      if (!continuation) break

      let resumeReady = false
      const localPendingPromises = continuation.pendingToolCallIds
        .map((toolCallId) => context.pendingToolPromises.get(toolCallId))
        .filter(
          (
            promise
          ): promise is Promise<{
            status: string
            message?: string
            data?: Record<string, unknown>
          }> => !!promise
        )
      if (localPendingPromises.length > 0) {
        logger.warn(ASYNC_RESUME_DIAG_TAG, {
          phase: 'waiting_local_async_tools',
          checkpointId: continuation.checkpointId,
          runId: continuation.runId,
          pendingToolCallIds: continuation.pendingToolCallIds,
        })
        await Promise.allSettled(localPendingPromises)
        logger.warn(ASYNC_RESUME_DIAG_TAG, {
          phase: 'local_async_tools_settled',
          checkpointId: continuation.checkpointId,
          runId: continuation.runId,
          pendingToolCallIds: continuation.pendingToolCallIds,
        })
      }

      const readiness = await waitForCheckpointReady(continuation.checkpointId, options.abortSignal)
      if (!readiness.ready) {
        logger.warn(ASYNC_RESUME_DIAG_TAG, {
          phase: 'checkpoint_not_ready',
          checkpointId: continuation.checkpointId,
          runId: continuation.runId,
          resumeState: readiness.resumeState,
          missingCallIds: readiness.missingCallIds,
          code: readiness.code,
          retryable: readiness.retryable,
        })
        context.errors.push(
          readiness.error ||
            `Failed to resume async tool continuation for checkpoint ${continuation.checkpointId}`
        )
        context.awaitingAsyncContinuation = undefined
        break
      }

      logger.warn(ASYNC_RESUME_DIAG_TAG, {
        phase: 'issuing_resume_request',
        checkpointId: continuation.checkpointId,
        runId: continuation.runId,
        pendingToolCallIds: continuation.pendingToolCallIds,
      })

      context.awaitingAsyncContinuation = undefined
      route = '/api/tools/resume'
      payload = {
        checkpointId: continuation.checkpointId,
      }
      resumeReady = true

      if (!resumeReady) {
        break
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
