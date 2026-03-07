import { createLogger } from '@sim/logger'
import type { BlockOutput } from '@/blocks/types'
import { BlockType } from '@/executor/constants'
import {
  parseResponseFormat,
  processStructuredResponse,
  resolveMessages,
} from '@/executor/handlers/shared/response-format'
import type { BlockHandler, ExecutionContext } from '@/executor/types'
import { buildAPIUrl, buildAuthHeaders, extractAPIErrorMessage } from '@/executor/utils/http'
import type { SerializedBlock } from '@/serializer/types'

const logger = createLogger('MothershipBlockHandler')

/**
 * Handler for Mothership blocks that proxy requests to the Mothership AI agent.
 *
 * Unlike the Agent block (which calls LLM providers directly), the Mothership
 * block delegates to the full Mothership infrastructure: main agent, subagents,
 * integration tools, memory, and workspace context.
 */
export class MothershipBlockHandler implements BlockHandler {
  canHandle(block: SerializedBlock): boolean {
    return block.metadata?.id === BlockType.MOTHERSHIP
  }

  async execute(
    ctx: ExecutionContext,
    block: SerializedBlock,
    inputs: Record<string, any>
  ): Promise<BlockOutput> {
    const messages = resolveMessages(inputs.messages)
    const responseFormat = parseResponseFormat(inputs.responseFormat)

    const memoryType = inputs.memoryType || 'none'
    const chatId =
      memoryType === 'conversation' && inputs.conversationId
        ? inputs.conversationId
        : crypto.randomUUID()

    const url = buildAPIUrl('/api/mothership/execute')
    const headers = await buildAuthHeaders()

    const body: Record<string, unknown> = {
      messages,
      workspaceId: ctx.workspaceId || '',
      userId: ctx.userId || '',
      chatId,
    }
    if (responseFormat) {
      body.responseFormat = responseFormat
    }

    logger.info('Executing Mothership block', {
      blockId: block.id,
      messageCount: messages.length,
      hasResponseFormat: !!responseFormat,
      memoryType,
      hasConversationId: memoryType === 'conversation',
    })

    const response = await fetch(url.toString(), {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const errorMsg = await extractAPIErrorMessage(response)
      throw new Error(`Mothership execution failed: ${errorMsg}`)
    }

    const result = await response.json()

    const formattedList = (result.toolCalls || []).map((tc: Record<string, unknown>) => ({
      name: tc.name,
      arguments: tc.params || {},
      result: tc.result,
      error: tc.error,
      duration: tc.durationMs || 0,
    }))
    const toolCalls = { list: formattedList, count: formattedList.length }

    if (responseFormat && result.content) {
      const structured = processStructuredResponse(result, 'mothership') as Record<string, unknown>
      return { ...structured, toolCalls, cost: result.cost || undefined } as BlockOutput
    }

    return {
      content: result.content || '',
      model: result.model || 'mothership',
      tokens: result.tokens || {},
      toolCalls,
      cost: result.cost || undefined,
    }
  }
}
