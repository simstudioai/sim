import { createLogger } from '@sim/logger'
import {
  ASYNC_TOOL_STATUS,
  inferDeliveredAsyncSuccess,
  isDeliveredAsyncStatus,
  isTerminalAsyncStatus,
} from '@/lib/copilot/async-runs/lifecycle'
import {
  claimCompletedAsyncToolCall,
  getAsyncToolCall,
  getAsyncToolCalls,
  markAsyncToolDelivered,
  releaseCompletedAsyncToolClaim,
  updateRunStatus,
} from '@/lib/copilot/async-runs/repository'
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

function didAsyncToolSucceed(input: {
  durableStatus?: string | null
  durableResult?: Record<string, unknown>
  durableError?: string | null
  completion?: { status: string } | undefined
  toolStateSuccess?: boolean | undefined
  toolStateStatus?: string | undefined
}) {
  const {
    durableStatus,
    durableResult,
    durableError,
    completion,
    toolStateSuccess,
    toolStateStatus,
  } = input

  if (durableStatus === ASYNC_TOOL_STATUS.completed) {
    return true
  }
  if (durableStatus === ASYNC_TOOL_STATUS.failed || durableStatus === ASYNC_TOOL_STATUS.cancelled) {
    return false
  }

  if (durableStatus === ASYNC_TOOL_STATUS.delivered) {
    return inferDeliveredAsyncSuccess({
      result: durableResult,
      error: durableError,
    })
  }

  if (toolStateStatus === 'success') return true
  if (toolStateStatus === 'error' || toolStateStatus === 'cancelled') return false

  return completion?.status === 'success' || toolStateSuccess === true
}

export interface OrchestrateStreamOptions extends OrchestratorOptions {
  userId: string
  workflowId?: string
  workspaceId?: string
  chatId?: string
  executionId?: string
  runId?: string
  /** Go-side route to proxy to. Defaults to '/api/copilot'. */
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
  let claimedToolCallIds: string[] = []
  let claimedByWorkerId: string | null = null

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
            if (response.async_pause) {
              if (runId) {
                await updateRunStatus(runId, 'paused_waiting_for_tool').catch(() => {})
              }
            }
          }
          await callerOnEvent?.(event)
        },
      }

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

      if (claimedToolCallIds.length > 0) {
        logger.info('Marking async tool calls as delivered', { toolCallIds: claimedToolCallIds })
        await Promise.all(
          claimedToolCallIds.map((toolCallId) =>
            markAsyncToolDelivered(toolCallId).catch(() => null)
          )
        )
        claimedToolCallIds = []
        claimedByWorkerId = null
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
      for (;;) {
        claimedToolCallIds = []
        const resumeWorkerId = continuation.runId || context.runId || context.messageId
        claimedByWorkerId = resumeWorkerId
        const claimableToolCallIds: string[] = []
        const localPendingPromises: Promise<unknown>[] = []
        for (const toolCallId of continuation.pendingToolCallIds) {
          const claimed = await claimCompletedAsyncToolCall(toolCallId, resumeWorkerId).catch(
            () => null
          )
          if (claimed) {
            claimableToolCallIds.push(toolCallId)
            claimedToolCallIds.push(toolCallId)
            continue
          }
          const durableRow = await getAsyncToolCall(toolCallId).catch(() => null)
          const localPendingPromise = context.pendingToolPromises.get(toolCallId)
          if (!durableRow && localPendingPromise) {
            claimableToolCallIds.push(toolCallId)
            continue
          }
          if (
            durableRow &&
            durableRow.status === ASYNC_TOOL_STATUS.running &&
            localPendingPromise
          ) {
            localPendingPromises.push(localPendingPromise)
            logger.info('Waiting for local async tool completion before retrying resume claim', {
              toolCallId,
              runId: continuation.runId,
            })
            continue
          }
          const toolState = context.toolCalls.get(toolCallId)
          if (!durableRow && !localPendingPromise && toolState) {
            logger.info('Including Go-handled tool in resume payload (no Sim-side row)', {
              toolCallId,
              toolName: toolState.name,
              status: toolState.status,
              runId: continuation.runId,
            })
            claimableToolCallIds.push(toolCallId)
            continue
          }
          logger.warn('Skipping already-claimed or missing async tool resume', {
            toolCallId,
            runId: continuation.runId,
          })
        }

        if (localPendingPromises.length > 0) {
          await Promise.allSettled(localPendingPromises)
          continue
        }

        if (claimableToolCallIds.length === 0) {
          logger.warn('Skipping async resume because no tool calls were claimable', {
            checkpointId: continuation.checkpointId,
            runId: continuation.runId,
          })
          context.awaitingAsyncContinuation = undefined
          break
        }

        logger.info('Resuming async tool continuation', {
          checkpointId: continuation.checkpointId,
          runId: continuation.runId,
          toolCallIds: claimableToolCallIds,
        })

        const durableRows = await getAsyncToolCalls(claimableToolCallIds).catch(() => [])
        const durableByToolCallId = new Map(durableRows.map((row) => [row.toolCallId, row]))

        const results = await Promise.all(
          claimableToolCallIds.map(async (toolCallId) => {
            const completion = await context.pendingToolPromises.get(toolCallId)
            const toolState = context.toolCalls.get(toolCallId)

            const durable = durableByToolCallId.get(toolCallId)
            const durableStatus = durable?.status
            const durableResult =
              durable?.result && typeof durable.result === 'object'
                ? (durable.result as Record<string, unknown>)
                : undefined
            const success = didAsyncToolSucceed({
              durableStatus,
              durableResult,
              durableError: durable?.error,
              completion,
              toolStateSuccess: toolState?.result?.success,
              toolStateStatus: toolState?.status,
            })
            const data =
              durableResult ||
              completion?.data ||
              (toolState?.result?.output as Record<string, unknown> | undefined) ||
              (success
                ? { message: completion?.message || 'Tool completed' }
                : {
                    error:
                      completion?.message || durable?.error || toolState?.error || 'Tool failed',
                  })

            if (
              durableStatus &&
              !isTerminalAsyncStatus(durableStatus) &&
              !isDeliveredAsyncStatus(durableStatus)
            ) {
              logger.warn('Async tool row was claimed for resume without terminal durable state', {
                toolCallId,
                status: durableStatus,
              })
            }

            return {
              callId: toolCallId,
              name: durable?.toolName || toolState?.name || '',
              data,
              success,
            }
          })
        )

        context.awaitingAsyncContinuation = undefined
        route = '/api/tools/resume'
        payload = {
          checkpointId: continuation.checkpointId,
          results,
        }
        resumeReady = true
        break
      }

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
    if (claimedToolCallIds.length > 0 && claimedByWorkerId) {
      logger.warn('Releasing async tool claims after delivery failure', {
        toolCallIds: claimedToolCallIds,
        workerId: claimedByWorkerId,
      })
      await Promise.all(
        claimedToolCallIds.map((toolCallId) =>
          releaseCompletedAsyncToolClaim(toolCallId, claimedByWorkerId!).catch(() => null)
        )
      )
    }
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
