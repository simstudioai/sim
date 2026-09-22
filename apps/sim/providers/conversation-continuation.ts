import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import { env } from '@/lib/core/config/env'
import { decryptMemoryCheckpoint } from '@/lib/memory/checkpoint-codec'
import type { AgentConversationSession } from '@/lib/memory/conversation-types'
import { renderConversationExecutionRecord } from '@/lib/memory/execution-record'
import { isChatCompletionsEndpoint } from '@/providers/azure-openai/utils'
import { getConfiguredConversationToolBinding } from '@/providers/conversation-history'
import {
  getEncryptedConversationMessage,
  getNativeConversationMessage,
  retainCompatibleNativeConversationMessage,
  setNativeConversationMessage,
} from '@/providers/conversation-metadata'
import { providerHistoryProtocols, requiresNativeToolHistory } from '@/providers/history-adapters'
import { executeProviderTool } from '@/providers/runtime-context'
import { isAbortError } from '@/providers/streaming-tool-loop-shared'
import type { Message, ProviderId, ProviderRequest } from '@/providers/types'
import { prepareToolExecution } from '@/providers/utils'

const logger = createLogger('AgentMemoryContinuation')

/** Pending calls have no recorded outcome: retrying them deliberately provides at-least-once effects. */
export async function continuePendingConversationCalls(
  request: ProviderRequest,
  session: AgentConversationSession
): Promise<void> {
  for (const call of session.getPendingCalls()) {
    request.abortSignal?.throwIfAborted()
    const tool = request.tools?.find((candidate) => candidate.id === call.toolId)
    if (!tool) {
      const result = {
        success: false,
        output: {},
        error: `Tool ${call.toolId} is no longer available`,
      }
      await session.recordToolResult({
        invocationId: call.invocationId,
        rawResponse: result,
        modelResponse: result,
      })
      continue
    }
    if (
      !call.configuredToolBinding ||
      call.configuredToolBinding !== getConfiguredConversationToolBinding(tool)
    ) {
      const result = {
        success: false,
        output: {},
        error:
          'The recorded tool configuration could not be verified; its previous outcome remains unknown.',
      }
      await session.recordToolResult({
        invocationId: call.invocationId,
        rawResponse: result,
        modelResponse: result,
      })
      continue
    }
    let args: unknown
    try {
      args = JSON.parse(call.arguments)
    } catch {
      args = undefined
    }
    if (!isRecordLike(args)) {
      const result = {
        success: false,
        output: {},
        error: 'Tool arguments are not a valid JSON object',
      }
      await session.recordToolResult({
        invocationId: call.invocationId,
        rawResponse: result,
        modelResponse: result,
      })
      continue
    }
    const { executionParams } = prepareToolExecution(
      tool,
      args,
      {
        ...request,
        resolveToolInvocationId: () => call.invocationId,
      },
      call.providerCallId
    )
    try {
      logger.info('Retrying an Agent tool with an unrecorded outcome')
      await executeProviderTool(tool.id, executionParams)
    } catch (error) {
      if (
        isAbortError(error) ||
        request.abortSignal?.aborted ||
        (isRecordLike(error) && error.retryable === false)
      )
        throw error
      const result = { success: false, output: {}, error: getErrorMessage(error) }
      await session.recordToolResult({
        invocationId: call.invocationId,
        rawResponse: result,
        modelResponse: result,
      })
    }
  }
}

/** Complete tool batches are indivisible even when a fallback has a smaller context window. */
export function groupConversationMessages(messages: readonly Message[]): Message[][] {
  const groups: Message[][] = []
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index]
    if (message.role === 'tool') continue
    const group = [message]
    if (message.tool_calls?.length) {
      const expected = new Set(message.tool_calls.map((call) => call.id))
      while (messages[index + 1]?.role === 'tool') {
        const result = messages[++index]
        if (result.tool_call_id && expected.delete(result.tool_call_id)) group.push(result)
      }
      if (expected.size > 0) continue
    }
    groups.push(group)
  }
  return groups
}

export async function restoreConversationNativeMessages(
  messages: Message[],
  providerId: ProviderId,
  model: string,
  binding: string,
  memoryId?: string,
  request?: Pick<ProviderRequest, 'azureEndpoint'>
): Promise<Message[]> {
  const protocol =
    providerId === 'azure-openai' &&
    isChatCompletionsEndpoint(request?.azureEndpoint || env.AZURE_OPENAI_ENDPOINT || '')
      ? 'chat-completions'
      : providerHistoryProtocols[providerId]
  if (!protocol) throw new Error('Evaluation providers do not support conversation history')
  const restored: Message[] = []
  for (const group of groupConversationMessages(messages)) {
    const first = group[0]
    retainCompatibleNativeConversationMessage(first, { protocol, providerId, model, binding })
    const encrypted = getEncryptedConversationMessage(first)
    if (encrypted && memoryId) {
      try {
        const envelope = await decryptMemoryCheckpoint(encrypted)
        if (
          isRecordLike(envelope) &&
          envelope.memoryId === memoryId &&
          isRecordLike(envelope.native)
        ) {
          const native = envelope.native
          if (
            native.providerId === providerId &&
            native.model === model &&
            native.binding === binding &&
            native.protocol === protocol
          ) {
            setNativeConversationMessage(first, {
              protocol,
              providerId,
              model,
              binding,
              ...(typeof native.prefixHash === 'string' ? { prefixHash: native.prefixHash } : {}),
              value: native.value,
            })
          }
        }
      } catch {
        logger.warn('Agent memory native continuation unavailable')
      }
    }
    if (
      first.tool_calls?.length &&
      !getNativeConversationMessage(first, protocol) &&
      requiresNativeToolHistory(providerId)
    ) {
      logger.info('Agent memory used portable execution history', { protocol })
      restored.push(renderConversationExecutionRecord(group))
    } else restored.push(...group)
  }
  return restored
}
