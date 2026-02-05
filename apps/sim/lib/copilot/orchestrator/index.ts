import { createLogger } from '@sim/logger'
import { SIM_AGENT_API_URL } from '@/lib/copilot/constants'
import { prepareExecutionContext } from '@/lib/copilot/orchestrator/tool-executor'
import type { OrchestratorOptions, OrchestratorResult } from '@/lib/copilot/orchestrator/types'
import { env } from '@/lib/core/config/env'
import { buildToolCallSummaries, createStreamingContext, runStreamLoop } from './stream-core'

const logger = createLogger('CopilotOrchestrator')

export interface OrchestrateStreamOptions extends OrchestratorOptions {
  userId: string
  workflowId: string
  chatId?: string
}

export async function orchestrateCopilotStream(
  requestPayload: Record<string, any>,
  options: OrchestrateStreamOptions
): Promise<OrchestratorResult> {
  const { userId, workflowId, chatId } = options
  const execContext = await prepareExecutionContext(userId, workflowId)

  const context = createStreamingContext({
    chatId,
    messageId: requestPayload?.messageId || crypto.randomUUID(),
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
