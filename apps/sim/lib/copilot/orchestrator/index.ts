import { createLogger } from '@sim/logger'
import { SIM_AGENT_API_URL } from '@/lib/copilot/constants'
import { prepareExecutionContext } from '@/lib/copilot/orchestrator/tool-executor'
import type {
  ExecutionContext,
  OrchestratorOptions,
  OrchestratorResult,
} from '@/lib/copilot/orchestrator/types'
import { env } from '@/lib/core/config/env'
import { getEffectiveDecryptedEnv } from '@/lib/environment/utils'
import { buildToolCallSummaries, createStreamingContext, runStreamLoop } from './stream-core'

const logger = createLogger('CopilotOrchestrator')

export interface OrchestrateStreamOptions extends OrchestratorOptions {
  userId: string
  workflowId?: string
  workspaceId?: string
  chatId?: string
}

export async function orchestrateCopilotStream(
  requestPayload: Record<string, unknown>,
  options: OrchestrateStreamOptions
): Promise<OrchestratorResult> {
  const { userId, workflowId, workspaceId, chatId } = options

  let execContext: ExecutionContext
  if (workflowId) {
    execContext = await prepareExecutionContext(userId, workflowId)
  } else {
    const decryptedEnvVars = await getEffectiveDecryptedEnv(userId, workspaceId)
    execContext = {
      userId,
      workflowId: '',
      workspaceId,
      decryptedEnvVars,
    }
  }

  const payloadMsgId = requestPayload?.messageId
  const context = createStreamingContext({
    chatId,
    messageId: typeof payloadMsgId === 'string' ? payloadMsgId : crypto.randomUUID(),
  })

  try {
    await runStreamLoop(
      `${SIM_AGENT_API_URL}/api/chat-completion-streaming`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(env.COPILOT_API_KEY ? { 'x-api-key': env.COPILOT_API_KEY } : {}),
        },
        body: JSON.stringify(requestPayload),
      },
      context,
      execContext,
      options
    )

    const result: OrchestratorResult = {
      success: context.errors.length === 0,
      content: context.accumulatedContent,
      contentBlocks: context.contentBlocks,
      toolCalls: buildToolCallSummaries(context),
      chatId: context.chatId,
      conversationId: context.conversationId,
      errors: context.errors.length ? context.errors : undefined,
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
      conversationId: context.conversationId,
      error: err.message,
    }
  }
}
