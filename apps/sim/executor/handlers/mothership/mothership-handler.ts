import { createLogger } from '@sim/logger'
import { toError } from '@/lib/core/utils/helpers'
import { generateId } from '@/lib/core/utils/uuid'
import { isExecutionCancelled, isRedisCancellationEnabled } from '@/lib/execution/cancellation'
import type { BlockOutput } from '@/blocks/types'
import { BlockType } from '@/executor/constants'
import type { BlockHandler, ExecutionContext } from '@/executor/types'
import { buildAPIUrl, buildAuthHeaders, extractAPIErrorMessage } from '@/executor/utils/http'
import type { SerializedBlock } from '@/serializer/types'

const logger = createLogger('MothershipBlockHandler')
const CANCELLATION_CHECK_INTERVAL_MS = 500

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
    const chatId = generateId()
    const messageId = generateId()
    const requestId = generateId()

    const url = buildAPIUrl('/api/mothership/execute')
    const headers = await buildAuthHeaders(ctx.userId)

    const body: Record<string, unknown> = {
      messages,
      workspaceId: ctx.workspaceId || '',
      userId: ctx.userId || '',
      chatId,
      messageId,
      requestId,
      ...(ctx.workflowId ? { workflowId: ctx.workflowId } : {}),
      ...(ctx.executionId ? { executionId: ctx.executionId } : {}),
    }

    logger.info('Executing Mothership block', {
      blockId: block.id,
      messageId,
      requestId,
      workflowId: ctx.workflowId,
      executionId: ctx.executionId,
    })

    const abortController = new AbortController()
    const onAbort = () => {
      if (!abortController.signal.aborted) {
        abortController.abort(ctx.abortSignal?.reason ?? 'workflow_abort')
      }
    }

    if (ctx.abortSignal?.aborted) {
      onAbort()
    } else {
      ctx.abortSignal?.addEventListener('abort', onAbort, { once: true })
    }

    const executionId = ctx.executionId
    const useRedisCancellation = isRedisCancellationEnabled() && !!executionId
    let pollInFlight = false
    const cancellationPoller =
      useRedisCancellation && executionId
        ? setInterval(() => {
            if (pollInFlight || abortController.signal.aborted) {
              return
            }
            pollInFlight = true
            void isExecutionCancelled(executionId)
              .then((cancelled) => {
                if (cancelled && !abortController.signal.aborted) {
                  abortController.abort('workflow_execution_cancelled')
                }
              })
              .catch((error) => {
                logger.warn('Failed to poll workflow cancellation for Mothership block', {
                  blockId: block.id,
                  executionId,
                  error: toError(error).message,
                })
              })
              .finally(() => {
                pollInFlight = false
              })
          }, CANCELLATION_CHECK_INTERVAL_MS)
        : undefined

    let response: Response
    try {
      response = await fetch(url.toString(), {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: abortController.signal,
      })
    } finally {
      if (cancellationPoller) {
        clearInterval(cancellationPoller)
      }
      ctx.abortSignal?.removeEventListener('abort', onAbort)
    }

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
