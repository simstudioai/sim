import { createLogger } from '@sim/logger'
import { isRecordLike, omit } from '@sim/utils/object'
import {
  AgentContextLimitError,
  type ConversationContextGroup,
  getConversationHistoryTokenBudget,
  selectConversationContextGroups,
} from '@/lib/memory/context-policy'
import { getConversationTokenCount } from '@/lib/memory/context-tokens'
import type { ConversationProtocol } from '@/lib/memory/conversation-types'
import {
  conversationAttachmentTokenSurcharge,
  conversationAttachmentTokensByReference,
} from '@/providers/conversation-attachments'
import {
  bindConversationRequestContext,
  getConversationRequestContext,
} from '@/providers/conversation-history'
import { getConversationModelLimits } from '@/providers/conversation-model'
import { isAbortError } from '@/providers/streaming-tool-loop-shared'
import type { Message, ProviderRequest } from '@/providers/types'

interface GenerationItem {
  value: unknown
  role: 'system' | 'user' | 'assistant' | 'other'
  texts: string[]
  calls: string[]
  results: string[]
  prefixBound: boolean
  hasAttachments: boolean
}

interface GenerationGroup {
  items: unknown[]
  role: GenerationItem['role']
  texts: string[]
  toolExchange: boolean
  prefixBound: boolean
  hasAttachments: boolean
}

type ConversationGenerationCompactor = (options: {
  maxSummaryTokens: number
}) => Promise<Message | undefined>

interface GenerationContext {
  prompt?: Message
  summary?: Message
  compact?: ConversationGenerationCompactor
}

const generationContexts = new WeakMap<ProviderRequest, GenerationContext>()
const logger = createLogger('AgentGenerationContext')

function getGenerationContext(request: ProviderRequest): GenerationContext {
  let context = generationContexts.get(request)
  if (!context) {
    context = {}
    generationContexts.set(request, context)
  }
  return context
}

/** The current prompt is identified before durable continuation records are appended. */
export function bindConversationGenerationPrompt(request: ProviderRequest, prompt?: Message): void {
  if (prompt) getGenerationContext(request).prompt = prompt
}

/** Only a trusted derived note receives summary priority; wire text cannot promote itself. */
export function bindConversationGenerationSummary(
  request: ProviderRequest,
  summary: Message
): void {
  getGenerationContext(request).summary = summary
}

/** The callback reads safe canonical history itself; native payloads never cross this boundary. */
export function bindConversationGenerationCompactor(
  request: ProviderRequest,
  compact: ConversationGenerationCompactor
): void {
  getGenerationContext(request).compact = compact
}

/** Wire-model aliases preserve the trusted conversation owner and original required prompt. */
export function inheritConversationGenerationContext(
  request: ProviderRequest,
  target: ProviderRequest
): ProviderRequest {
  const runtime = getConversationRequestContext(request)
  if (runtime) bindConversationRequestContext(target, runtime)
  const context = generationContexts.get(request)
  if (context) generationContexts.set(target, { ...context })
  return target
}

class AgentContextProtocolError extends Error {
  readonly retryable = false
}

function contextError(message: string): Error {
  return new AgentContextProtocolError(message)
}

/** Provider wrappers must preserve permanent context failures so fallback cannot restart them. */
export function isConversationContextError(error: unknown): boolean {
  return error instanceof AgentContextLimitError || error instanceof AgentContextProtocolError
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecordLike) : []
}

function callKey(id: unknown, name?: unknown): string {
  if (typeof id === 'string' && id) return `id:${id}`
  if (typeof name === 'string' && name) return `name:${name}`
  throw contextError('Agent context contains a tool exchange without a call identity.')
}

/** Native adapters describe indivisible exchanges; selection belongs to the shared memory policy. */
function describeGenerationItem(value: unknown, protocol: ConversationProtocol): GenerationItem {
  if (!isRecordLike(value)) {
    throw contextError('Agent context contains an unsupported provider message.')
  }
  const item: GenerationItem = {
    value,
    role:
      value.role === 'system' || value.role === 'developer'
        ? 'system'
        : value.role === 'user'
          ? 'user'
          : value.role === 'assistant' || value.role === 'model'
            ? 'assistant'
            : 'other',
    texts: typeof value.content === 'string' ? [value.content] : [],
    calls: [],
    results: [],
    prefixBound: false,
    hasAttachments: false,
  }
  const contentParts = records(protocol === 'gemini' ? value.parts : value.content)
  for (const part of contentParts) {
    if (typeof part.text === 'string') item.texts.push(part.text)
  }
  item.hasAttachments = contentParts.some(
    (part) =>
      [
        'input_image',
        'input_file',
        'input_audio',
        'image_url',
        'file',
        'image',
        'document',
      ].includes(String(part.type)) ||
      'inlineData' in part ||
      'fileData' in part ||
      'image' in part ||
      'document' in part ||
      'video' in part
  )
  if (protocol === 'responses') {
    if (value.type === 'function_call') {
      item.role = 'assistant'
      item.calls.push(callKey(value.call_id))
    } else if (value.type === 'function_call_output') {
      item.results.push(callKey(value.call_id))
    } else if (value.type === 'reasoning') item.role = 'assistant'
  } else if (protocol === 'chat-completions') {
    for (const call of records(value.tool_calls)) item.calls.push(callKey(call.id))
    if (isRecordLike(value.function_call)) {
      item.calls.push(callKey(undefined, value.function_call.name))
    }
    if (value.role === 'tool') item.results.push(callKey(value.tool_call_id))
    if (value.role === 'function') item.results.push(callKey(undefined, value.name))
  } else {
    const parts = records(protocol === 'gemini' ? value.parts : value.content)
    for (const part of parts) {
      if (protocol === 'anthropic') {
        if (part.type === 'tool_use') item.calls.push(callKey(part.id))
        if (part.type === 'tool_result') item.results.push(callKey(part.tool_use_id))
      } else if (protocol === 'gemini') {
        if (isRecordLike(part.functionCall)) {
          item.calls.push(callKey(part.functionCall.id, part.functionCall.name))
        }
        if (isRecordLike(part.functionResponse)) {
          item.results.push(callKey(part.functionResponse.id, part.functionResponse.name))
        }
      } else {
        if (isRecordLike(part.toolUse)) item.calls.push(callKey(part.toolUse.toolUseId))
        if (isRecordLike(part.toolResult)) item.results.push(callKey(part.toolResult.toolUseId))
        if ('reasoningContent' in part) item.prefixBound = true
      }
    }
  }
  return item
}

function groupGenerationItems(
  items: readonly unknown[],
  protocol: ConversationProtocol
): GenerationGroup[] {
  const described = items.map((item) => describeGenerationItem(item, protocol))
  const groups: GenerationGroup[] = []
  for (let index = 0; index < described.length; index++) {
    const first = described[index]
    if (first.results.length) {
      throw contextError(
        'Agent context contains a tool result without its complete assistant call batch.'
      )
    }
    const members = [first]
    if (protocol === 'responses' && first.role === 'assistant') {
      while (described[index + 1]?.role === 'assistant' && !described[index + 1].results.length) {
        members.push(described[++index])
      }
    }
    const expected = members.flatMap((member) => member.calls)
    const toolExchange = expected.length > 0
    if (toolExchange) {
      while (described[index + 1]?.results.length) {
        const result = described[++index]
        for (const key of result.results) {
          const expectedIndex = expected.indexOf(key)
          if (expectedIndex < 0) {
            throw contextError(
              'Agent context contains a tool result without a matching assistant call.'
            )
          }
          expected.splice(expectedIndex, 1)
        }
        members.push(result)
      }
      if (expected.length) {
        throw contextError(
          'Agent context contains an incomplete tool call batch; all parallel results are required.'
        )
      }
    }
    groups.push({
      items: members.map((member) => member.value),
      role: first.role,
      texts: members.flatMap((member) => member.texts),
      toolExchange,
      prefixBound: members.some((member) => member.prefixBound),
      hasAttachments: members.some((member) => member.hasAttachments),
    })
  }
  return groups
}

function tokenCount(value: unknown, model: string): number {
  const serialized = JSON.stringify(value)
  return serialized ? getConversationTokenCount(serialized, model) : 0
}

function outputTokens(request: ProviderRequest, payload: Record<string, unknown>): number {
  const config = isRecordLike(payload.config) ? payload.config : {}
  const inference = isRecordLike(payload.inferenceConfig) ? payload.inferenceConfig : {}
  for (const value of [
    payload.max_output_tokens,
    payload.max_completion_tokens,
    payload.max_tokens,
    config.maxOutputTokens,
    inference.maxTokens,
    request.maxTokens,
  ]) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
  }
  return getConversationModelLimits(request.model).outputTokens
}

function nativeSummaryMessage(summary: Message, protocol: ConversationProtocol): unknown {
  const text = summary.content ?? ''
  if (protocol === 'gemini') return { role: 'user', parts: [{ text }] }
  if (protocol === 'responses') return { role: 'user', content: [{ type: 'input_text', text }] }
  if (protocol === 'anthropic') return { role: 'user', content: [{ type: 'text', text }] }
  if (protocol === 'bedrock') return { role: 'user', content: [{ text }] }
  return { role: 'user', content: text }
}

/**
 * Runs immediately before every provider generation, including tool-loop turns and synthesis.
 * Native objects retain their identity and signatures. A required exchange that cannot fit
 * fails before the SDK send; it is never shortened into a malformed or misleading transcript.
 */
export async function prepareConversationGeneration<T>(
  request: ProviderRequest,
  protocol: ConversationProtocol,
  payload: T
): Promise<T> {
  const runtime = getConversationRequestContext(request)
  if (!runtime?.agentConversation) return payload
  request.abortSignal?.throwIfAborted()
  if (!isRecordLike(payload))
    throw contextError('Agent generation has an invalid provider payload.')
  const key = protocol === 'responses' ? 'input' : protocol === 'gemini' ? 'contents' : 'messages'
  const items = payload[key]
  if (!Array.isArray(items)) throw contextError('Agent generation has no provider message list.')

  const groups = groupGenerationItems(items, protocol)
  const context = getGenerationContext(request)
  const currentPrompt =
    context.prompt ??
    [...(request.messages ?? [])].reverse().find((message) => message.role === 'user')
  let promptIndex = -1
  let newestToolIndex = -1
  let prefixBoundIndex = -1
  for (const [index, group] of groups.entries()) {
    if (
      group.role === 'user' &&
      !group.toolExchange &&
      (currentPrompt?.content
        ? group.texts.includes(currentPrompt.content)
        : currentPrompt?.files?.length
          ? group.hasAttachments
          : true)
    ) {
      promptIndex = index
    }
    if (group.toolExchange) newestToolIndex = index
    if (group.prefixBound) prefixBoundIndex = index
  }
  if (currentPrompt && promptIndex < 0) {
    throw contextError('Agent context could not preserve the current user prompt.')
  }
  const modelLimits = getConversationModelLimits(request.model)
  const attachmentTokensByReference = conversationAttachmentTokensByReference(
    (request.messages ?? []).flatMap((message) => message.files ?? [])
  )
  const policyGroups: ConversationContextGroup<unknown[]>[] = groups.map((group, index) => {
    const summary = Boolean(
      context.summary?.content &&
        group.role === 'user' &&
        !group.toolExchange &&
        group.texts.includes(context.summary.content)
    )
    return {
      value: group.items,
      tokens:
        tokenCount(group.items, request.model) +
        conversationAttachmentTokenSurcharge(
          group.items,
          protocol,
          request.model,
          attachmentTokensByReference
        ),
      summary,
      required:
        group.role === 'system' ||
        index === promptIndex ||
        index === newestToolIndex ||
        (index === groups.length - 1 && !summary) ||
        index <= prefixBoundIndex ||
        Boolean(request.context && group.role === 'user' && group.texts.includes(request.context)),
    }
  })
  const budget = {
    contextWindow: modelLimits.contextWindow,
    fixedTokens: tokenCount(omit(payload, [key]), request.model),
    outputTokens: outputTokens(request, payload),
    historyTokens: runtime.agentMemoryContext?.historyTokens,
  }
  let selected = selectConversationContextGroups(policyGroups, budget)
  const selectedGroups = new Set(selected)
  const omitsHistory = policyGroups.some(
    (group) => !group.required && !group.summary && !selectedGroups.has(group.value)
  )
  const maxSummaryTokens = getConversationHistoryTokenBudget(policyGroups, budget)
  if (omitsHistory && maxSummaryTokens > 0 && context.compact) {
    try {
      const summary = await context.compact({ maxSummaryTokens })
      request.abortSignal?.throwIfAborted()
      if (summary?.role === 'user' && summary.content?.trim()) {
        const summaryItems = [nativeSummaryMessage(summary, protocol)]
        const revised: ConversationContextGroup<unknown[]>[] = []
        let inserted = false
        for (const [index, group] of policyGroups.entries()) {
          /** Bedrock signed state keeps its exact original prefix; a new note follows it. */
          if (!inserted && index > prefixBoundIndex && groups[index].role !== 'system') {
            revised.push({
              value: summaryItems,
              tokens: tokenCount(summaryItems, request.model),
              summary: true,
            })
            inserted = true
          }
          if (!group.summary || group.required) revised.push(group)
        }
        if (!inserted) {
          revised.push({
            value: summaryItems,
            tokens: tokenCount(summaryItems, request.model),
            summary: true,
          })
        }
        const withSummary = selectConversationContextGroups(revised, budget)
        if (withSummary.includes(summaryItems)) {
          selected = withSummary
          context.summary = summary
        }
      }
    } catch (error) {
      if (isAbortError(error) || request.abortSignal?.aborted) throw error
      logger.warn('Agent context compaction unavailable; retaining bounded history')
    }
  }
  let selectedLength = 0
  for (const group of selected) {
    for (const item of group) items[selectedLength++] = item
  }
  items.length = selectedLength
  request.abortSignal?.throwIfAborted()
  return payload
}
