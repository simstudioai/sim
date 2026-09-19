import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import { truncate } from '@sim/utils/string'
import { env } from '@/lib/core/config/env'
import { decryptMemoryCheckpoint, projectableMemoryCheckpoint } from '@/lib/memory/checkpoint-codec'
import type { AgentConversationSession } from '@/lib/memory/conversation-types'
import { renderConversationExecutionRecord } from '@/lib/memory/execution-record'
import { getAccurateTokenCount } from '@/lib/tokenization/accurate'
import { isChatCompletionsEndpoint } from '@/providers/azure-openai/utils'
import { getConfiguredConversationToolBinding } from '@/providers/conversation-history'
import {
  getEncryptedConversationMessage,
  getNativeConversationMessage,
  retainCompatibleNativeConversationMessage,
  setNativeConversationMessage,
} from '@/providers/conversation-metadata'
import { providerHistoryProtocols, requiresNativeToolHistory } from '@/providers/history-adapters'
import { getMaxOutputTokensForModel, PROVIDER_DEFINITIONS } from '@/providers/models'
import { executeProviderTool } from '@/providers/runtime-context'
import { isAbortError } from '@/providers/streaming-tool-loop-shared'
import type { Message, ProviderId, ProviderRequest } from '@/providers/types'
import { prepareToolExecution } from '@/providers/utils'

const logger = createLogger('AgentMemoryContinuation')
const CONVERSATION_PROTOCOLS = [...new Set(Object.values(providerHistoryProtocols))]

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

function conversationGroupTokens(request: ProviderRequest, group: Message[]): number {
  let count = getAccurateTokenCount(JSON.stringify(group), request.model)
  for (const message of group) {
    for (const protocol of CONVERSATION_PROTOCOLS) {
      const native = getNativeConversationMessage(message, protocol)
      if (native === undefined) continue
      try {
        count += getAccurateTokenCount(
          JSON.stringify(projectableMemoryCheckpoint(native)),
          request.model
        )
      } catch {
        return Number.POSITIVE_INFINITY
      }
      break
    }
    for (const file of message.files ?? []) count += Math.ceil((file.size ?? 0) / 3)
  }
  return count
}

function compactConversationGroup(
  request: ProviderRequest,
  group: Message[],
  budget: number
): Message[] | undefined {
  const toolExchange = Boolean(group[0].tool_calls?.length)
  for (let length = 2048; length >= 128; length = Math.floor(length / 2)) {
    const compact: Message[] = toolExchange
      ? [renderConversationExecutionRecord(group, length)]
      : [
          {
            role: group[0].role,
            content: truncate(group[0].content ?? '', length, '… [history shortened]'),
          },
        ]
    if (conversationGroupTokens(request, compact) <= budget) return compact
  }
  if (!toolExchange) return undefined
  const compact: Message[] = [
    {
      role: 'user',
      content:
        'Prior tools have recorded outcomes. Their execution details were omitted to fit this model.',
    },
  ]
  return conversationGroupTokens(request, compact) <= budget ? compact : undefined
}

export function budgetConversationMessages(
  request: ProviderRequest,
  messages: Message[],
  requiredMessages: readonly Message[] = []
): Message[] {
  const definition = Object.values(PROVIDER_DEFINITIONS)
    .flatMap((provider) => provider.models)
    .find((model) => model.id.toLowerCase() === request.model.toLowerCase())
  const contextWindow = definition?.contextWindow ?? 32_000
  const fixed = getAccurateTokenCount(
    JSON.stringify({
      systemPrompt: request.systemPrompt,
      context: request.context,
      tools: request.tools?.map((tool) => ({
        id: tool.id,
        description: tool.description,
        parameters: tool.parameters,
      })),
      responseFormat: request.responseFormat,
    }),
    request.model
  )
  const modelOutputLimit = getMaxOutputTokensForModel(request.model)
  const reservedOutput =
    request.thinkingLevel && request.thinkingLevel !== 'none'
      ? Math.max(request.maxTokens ?? 0, modelOutputLimit)
      : (request.maxTokens ?? modelOutputLimit)
  let budget = Math.max(0, Math.floor(contextWindow * 0.9) - fixed - reservedOutput)
  const groups = groupConversationMessages(messages)
  const required = new Set(requiredMessages)
  const selected = new Map<number, Message[]>()
  let lastRequiredIndex = -1
  for (let index = 0; index < groups.length; index++) {
    const group = groups[index]
    if (!group.some((message) => required.has(message) || message.role === 'system')) continue
    selected.set(index, group)
    lastRequiredIndex = index
    budget -= conversationGroupTokens(request, group)
  }
  for (let index = groups.length - 1; index >= 0 && budget > 0; index--) {
    if (selected.has(index)) continue
    const group = groups[index]
    const count = conversationGroupTokens(request, group)
    if (count <= budget) {
      selected.set(index, group)
      budget -= count
      continue
    }
    if (index > lastRequiredIndex) {
      const compact = compactConversationGroup(request, group, budget)
      if (compact) {
        selected.set(index, compact)
        budget -= conversationGroupTokens(request, compact)
      }
    }
    break
  }
  const result = [...selected.entries()]
    .sort(([left], [right]) => left - right)
    .flatMap(([, group]) => group)
  logger.info('Agent memory request history selected', {
    model: request.model,
    messages: result.length,
    bytes: Buffer.byteLength(JSON.stringify(result)),
  })
  return result
}
