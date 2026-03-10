import { createLogger } from '@sim/logger'
import type { BlockOutput } from '@/blocks/types'
import { BlockType } from '@/executor/constants'
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
    const prompt = inputs.prompt
    if (!prompt || typeof prompt !== 'string') {
      throw new Error('Prompt input is required')
    }
    const messages = [{ role: 'user' as const, content: prompt }]
    const chatId = crypto.randomUUID()

    const url = buildAPIUrl('/api/mothership/execute')
    const headers = await buildAuthHeaders()

    const body: Record<string, unknown> = {
      messages,
      workspaceId: ctx.workspaceId || '',
      userId: ctx.userId || '',
      chatId,
    }

    logger.info('Executing Mothership block', {
      blockId: block.id,
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

    return {
      content: result.content || '',
      model: result.model || 'mothership',
      tokens: result.tokens || {},
      toolCalls,
      cost: result.cost || undefined,
    }
  }
}
