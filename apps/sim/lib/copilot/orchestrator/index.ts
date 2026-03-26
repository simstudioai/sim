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
import { buildToolCallSummaries, createStreamingContext, runStreamLoop } from './stream/core'

const logger = createLogger('CopilotOrchestrator')

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

      if (context.pendingToolPromises.size > 0) {
        logger.info('Waiting for in-flight tool executions before resume', {
          checkpointId: continuation.checkpointId,
          pendingCount: context.pendingToolPromises.size,
        })
        await Promise.allSettled(context.pendingToolPromises.values())
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
