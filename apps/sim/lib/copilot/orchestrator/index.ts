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
import { appendCopilotLogContext } from '@/lib/copilot/logging'
import {
  isToolAvailableOnSimSide,
  prepareExecutionContext,
} from '@/lib/copilot/orchestrator/tool-executor'
import {
  type ExecutionContext,
  isTerminalToolCallStatus,
  type OrchestratorOptions,
  type OrchestratorResult,
  type SSEEvent,
  type ToolCallState,
} from '@/lib/copilot/orchestrator/types'
import { env } from '@/lib/core/config/env'
import { getEffectiveDecryptedEnv } from '@/lib/environment/utils'
import { buildToolCallSummaries, createStreamingContext, runStreamLoop } from './stream/core'

const logger = createLogger('CopilotOrchestrator')

function didAsyncToolSucceed(input: {
  durableStatus?: string | null
  durableResult?: Record<string, unknown>
  durableError?: string | null
  toolStateStatus?: string | undefined
}) {
  const { durableStatus, durableResult, durableError, toolStateStatus } = input

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

  return false
}

interface ReadyContinuationTool {
  toolCallId: string
  toolState?: ToolCallState
  durableRow?: Awaited<ReturnType<typeof getAsyncToolCall>>
  needsDurableClaim: boolean
  alreadyClaimedByWorker: boolean
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
  execContext.userStopSignal = options.userStopSignal

  const payloadMsgId = requestPayload?.messageId
  const messageId = typeof payloadMsgId === 'string' ? payloadMsgId : crypto.randomUUID()
  execContext.messageId = messageId
  const context = createStreamingContext({
    chatId,
    executionId,
    runId,
    messageId,
  })
  const continuationWorkerId = `sim-resume:${crypto.randomUUID()}`
  const withLogContext = (message: string) =>
    appendCopilotLogContext(message, {
      requestId: context.requestId,
      messageId,
    })
  let claimedToolCallIds: string[] = []
  let claimedByWorkerId: string | null = null

  logger.error(withLogContext('Starting copilot orchestration'), {
    goRoute,
    workflowId,
    workspaceId,
    chatId,
    executionId,
    runId,
    hasUserTimezone: Boolean(userTimezone),
  })

  try {
    let route = goRoute
    let payload = requestPayload

    const callerOnEvent = options.onEvent

    for (;;) {
      context.streamComplete = false

      logger.error(withLogContext('Starting orchestration loop iteration'), {
        route,
        hasPendingAsyncContinuation: Boolean(context.awaitingAsyncContinuation),
        claimedToolCallCount: claimedToolCallIds.length,
      })

      const loopOptions = {
        ...options,
        onEvent: async (event: SSEEvent) => {
          if (event.type === 'done') {
            const d = (event.data ?? {}) as Record<string, unknown>
            const response = (d.response ?? {}) as Record<string, unknown>
            if (response.async_pause) {
              logger.error(withLogContext('Detected async pause from copilot backend'), {
                route,
                checkpointId:
                  typeof (response.async_pause as Record<string, unknown>)?.checkpointId ===
                  'string'
                    ? (response.async_pause as Record<string, unknown>).checkpointId
                    : undefined,
              })
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

      logger.error(withLogContext('Completed orchestration loop iteration'), {
        route,
        streamComplete: context.streamComplete,
        wasAborted: context.wasAborted,
        hasAsyncContinuation: Boolean(context.awaitingAsyncContinuation),
        errorCount: context.errors.length,
      })

      if (claimedToolCallIds.length > 0) {
        logger.error(withLogContext('Marking async tool calls as delivered'), {
          toolCallIds: claimedToolCallIds,
        })
        await Promise.all(
          claimedToolCallIds.map((toolCallId) =>
            markAsyncToolDelivered(toolCallId).catch(() => null)
          )
        )
        claimedToolCallIds = []
        claimedByWorkerId = null
      }

      if (options.abortSignal?.aborted || context.wasAborted) {
        logger.error(withLogContext('Stopping orchestration because request was aborted'), {
          pendingToolCallCount: Array.from(context.toolCalls.values()).filter(
            (toolCall) => toolCall.status === 'pending' || toolCall.status === 'executing'
          ).length,
        })
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
      if (!continuation) {
        logger.error(withLogContext('No async continuation pending; finishing orchestration'))
        break
      }

      let resumeReady = false
      let resumeRetries = 0
      logger.error(withLogContext('Processing async continuation'), {
        checkpointId: continuation.checkpointId,
        runId: continuation.runId,
        pendingToolCallIds: continuation.pendingToolCallIds,
      })
      for (;;) {
        claimedToolCallIds = []
        claimedByWorkerId = null
        const resumeWorkerId = continuationWorkerId
        const readyTools: ReadyContinuationTool[] = []
        const localPendingPromises: Promise<unknown>[] = []
        const missingToolCallIds: string[] = []

        for (const toolCallId of continuation.pendingToolCallIds) {
          const durableRow = await getAsyncToolCall(toolCallId).catch(() => null)
          const localPendingPromise = context.pendingToolPromises.get(toolCallId)
          const toolState = context.toolCalls.get(toolCallId)

          if (localPendingPromise) {
            localPendingPromises.push(localPendingPromise)
            logger.info(
              withLogContext(
                'Waiting for local async tool completion before retrying resume claim'
              ),
              {
                toolCallId,
                runId: continuation.runId,
                workerId: resumeWorkerId,
              }
            )
            continue
          }

          if (durableRow && isTerminalAsyncStatus(durableRow.status)) {
            if (durableRow.claimedBy && durableRow.claimedBy !== resumeWorkerId) {
              missingToolCallIds.push(toolCallId)
              logger.warn(
                withLogContext(
                  'Async tool continuation is waiting on a claim held by another worker'
                ),
                {
                  toolCallId,
                  runId: continuation.runId,
                  workerId: resumeWorkerId,
                  claimedBy: durableRow.claimedBy,
                }
              )
              continue
            }
            readyTools.push({
              toolCallId,
              toolState,
              durableRow,
              needsDurableClaim: durableRow.claimedBy !== resumeWorkerId,
              alreadyClaimedByWorker: durableRow.claimedBy === resumeWorkerId,
            })
            continue
          }

          if (
            !durableRow &&
            toolState &&
            isTerminalToolCallStatus(toolState.status) &&
            !isToolAvailableOnSimSide(toolState.name)
          ) {
            logger.info(
              withLogContext('Including Go-handled tool in resume payload (no Sim-side row)'),
              {
                toolCallId,
                toolName: toolState.name,
                status: toolState.status,
                runId: continuation.runId,
              }
            )
            readyTools.push({
              toolCallId,
              toolState,
              needsDurableClaim: false,
              alreadyClaimedByWorker: false,
            })
            continue
          }

          logger.warn(withLogContext('Skipping already-claimed or missing async tool resume'), {
            toolCallId,
            runId: continuation.runId,
            durableStatus: durableRow?.status,
            toolStateStatus: toolState?.status,
          })
          missingToolCallIds.push(toolCallId)
        }

        if (localPendingPromises.length > 0) {
          logger.info(
            withLogContext('Waiting for local pending async tools before resuming continuation'),
            {
              checkpointId: continuation.checkpointId,
              pendingPromiseCount: localPendingPromises.length,
            }
          )
          await Promise.allSettled(localPendingPromises)
          continue
        }

        if (missingToolCallIds.length > 0) {
          if (resumeRetries < 3) {
            resumeRetries++
            logger.info(
              withLogContext('Retrying async resume after some tool calls were not yet ready'),
              {
                checkpointId: continuation.checkpointId,
                runId: continuation.runId,
                workerId: resumeWorkerId,
                retry: resumeRetries,
                missingToolCallIds,
              }
            )
            await new Promise((resolve) => setTimeout(resolve, 250 * resumeRetries))
            continue
          }
          logger.error(
            withLogContext(
              'Async continuation failed because pending tool calls never became ready'
            ),
            {
              checkpointId: continuation.checkpointId,
              runId: continuation.runId,
              missingToolCallIds,
            }
          )
          throw new Error(
            `Failed to resume async tool continuation: pending tool calls were not ready (${missingToolCallIds.join(', ')})`
          )
        }

        if (readyTools.length === 0) {
          if (resumeRetries < 3 && continuation.pendingToolCallIds.length > 0) {
            resumeRetries++
            logger.info(
              withLogContext('Retrying async resume because no tool calls were ready yet'),
              {
                checkpointId: continuation.checkpointId,
                runId: continuation.runId,
                workerId: resumeWorkerId,
                retry: resumeRetries,
              }
            )
            await new Promise((resolve) => setTimeout(resolve, 250 * resumeRetries))
            continue
          }
          logger.error(
            withLogContext('Async continuation failed because no tool calls were ready'),
            {
              checkpointId: continuation.checkpointId,
              runId: continuation.runId,
              requestedToolCallIds: continuation.pendingToolCallIds,
            }
          )
          throw new Error('Failed to resume async tool continuation: no tool calls were ready')
        }

        const claimCandidates = readyTools.filter((tool) => tool.needsDurableClaim)
        const newlyClaimedToolCallIds: string[] = []
        const claimFailures: string[] = []

        for (const tool of claimCandidates) {
          const claimed = await claimCompletedAsyncToolCall(tool.toolCallId, resumeWorkerId).catch(
            () => null
          )
          if (!claimed) {
            claimFailures.push(tool.toolCallId)
            continue
          }
          newlyClaimedToolCallIds.push(tool.toolCallId)
        }

        if (claimFailures.length > 0) {
          if (newlyClaimedToolCallIds.length > 0) {
            logger.info(
              withLogContext('Releasing async tool claims after claim contention during resume'),
              {
                checkpointId: continuation.checkpointId,
                runId: continuation.runId,
                workerId: resumeWorkerId,
                newlyClaimedToolCallIds,
                claimFailures,
              }
            )
            await Promise.all(
              newlyClaimedToolCallIds.map((toolCallId) =>
                releaseCompletedAsyncToolClaim(toolCallId, resumeWorkerId).catch(() => null)
              )
            )
          }
          if (resumeRetries < 3) {
            resumeRetries++
            logger.error(withLogContext('Retrying async resume after claim contention'), {
              checkpointId: continuation.checkpointId,
              runId: continuation.runId,
              workerId: resumeWorkerId,
              retry: resumeRetries,
              claimFailures,
            })
            await new Promise((resolve) => setTimeout(resolve, 250 * resumeRetries))
            continue
          }
          logger.error(
            withLogContext('Async continuation failed because tool claims could not be acquired'),
            {
              checkpointId: continuation.checkpointId,
              runId: continuation.runId,
              claimFailures,
            }
          )
          throw new Error(
            `Failed to resume async tool continuation: unable to claim tool calls (${claimFailures.join(', ')})`
          )
        }

        claimedToolCallIds = [
          ...readyTools
            .filter((tool) => tool.alreadyClaimedByWorker)
            .map((tool) => tool.toolCallId),
          ...newlyClaimedToolCallIds,
        ]
        claimedByWorkerId = claimedToolCallIds.length > 0 ? resumeWorkerId : null

        logger.error(withLogContext('Resuming async tool continuation'), {
          checkpointId: continuation.checkpointId,
          runId: continuation.runId,
          workerId: resumeWorkerId,
          toolCallIds: readyTools.map((tool) => tool.toolCallId),
        })

        const durableRows = await getAsyncToolCalls(
          readyTools.map((tool) => tool.toolCallId)
        ).catch(() => [])
        const durableByToolCallId = new Map(durableRows.map((row) => [row.toolCallId, row]))

        const results = await Promise.all(
          readyTools.map(async (tool) => {
            const durable = durableByToolCallId.get(tool.toolCallId) || tool.durableRow
            const durableStatus = durable?.status
            const durableResult =
              durable?.result && typeof durable.result === 'object'
                ? (durable.result as Record<string, unknown>)
                : undefined
            const success = didAsyncToolSucceed({
              durableStatus,
              durableResult,
              durableError: durable?.error,
              toolStateStatus: tool.toolState?.status,
            })
            const data =
              durableResult ||
              (tool.toolState?.result?.output as Record<string, unknown> | undefined) ||
              (success
                ? { message: 'Tool completed' }
                : {
                    error: durable?.error || tool.toolState?.error || 'Tool failed',
                  })

            if (
              durableStatus &&
              !isTerminalAsyncStatus(durableStatus) &&
              !isDeliveredAsyncStatus(durableStatus)
            ) {
              logger.warn(
                withLogContext(
                  'Async tool row was claimed for resume without terminal durable state'
                ),
                {
                  toolCallId: tool.toolCallId,
                  status: durableStatus,
                }
              )
            }

            return {
              callId: tool.toolCallId,
              name: durable?.toolName || tool.toolState?.name || '',
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
        logger.error(withLogContext('Prepared async continuation payload for resume endpoint'), {
          route,
          checkpointId: continuation.checkpointId,
          resultCount: results.length,
        })
        resumeReady = true
        break
      }

      if (!resumeReady) {
        logger.warn(withLogContext('Async continuation loop exited without resume payload'), {
          checkpointId: continuation.checkpointId,
          runId: continuation.runId,
        })
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
    logger.error(withLogContext('Completing copilot orchestration'), {
      success: result.success,
      chatId: result.chatId,
      hasRequestId: Boolean(result.requestId),
      errorCount: result.errors?.length || 0,
      toolCallCount: result.toolCalls.length,
    })
    await options.onComplete?.(result)
    return result
  } catch (error) {
    const err = error instanceof Error ? error : new Error('Copilot orchestration failed')
    if (claimedToolCallIds.length > 0 && claimedByWorkerId) {
      logger.warn(withLogContext('Releasing async tool claims after delivery failure'), {
        toolCallIds: claimedToolCallIds,
        workerId: claimedByWorkerId,
      })
      await Promise.all(
        claimedToolCallIds.map((toolCallId) =>
          releaseCompletedAsyncToolClaim(toolCallId, claimedByWorkerId!).catch(() => null)
        )
      )
    }
    logger.error(withLogContext('Copilot orchestration failed'), {
      error: err.message,
    })
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
