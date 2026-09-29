import { isRecordLike, toRecord } from '@sim/utils/object'
import type {
  CapturedConversationStep,
  ConversationProtocol,
} from '@/lib/memory/conversation-types'
import { getKieConversationProtocol, isKieClaudeModel } from '@/providers/kie/utils'
import type { ProviderId } from '@/providers/types'

export interface ProviderHistoryAdapter {
  protocol: ConversationProtocol
  capture(value: unknown): Pick<CapturedConversationStep, 'assistant' | 'calls'>
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecordLike) : []
}

function argumentString(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value ?? {})
}

/** Captures only model-authored arguments; configured tool credentials never enter this boundary. */
function capture(
  protocol: ConversationProtocol,
  value: unknown
): ReturnType<ProviderHistoryAdapter['capture']> {
  const message = toRecord(value)
  const calls: CapturedConversationStep['calls'] = []
  const text: string[] = []
  const add = (id: unknown, name: unknown, args: unknown) => {
    if (typeof name !== 'string') return
    calls.push({
      ...(typeof id === 'string' ? { providerCallId: id } : {}),
      toolId: name,
      arguments: argumentString(args),
    })
  }
  if (protocol === 'chat-completions') {
    if (typeof message.content === 'string') text.push(message.content)
    for (const call of records(message.tool_calls)) {
      if (isRecordLike(call.function)) add(call.id, call.function.name, call.function.arguments)
    }
  } else if (protocol === 'responses') {
    for (const item of records(value)) {
      if (item.type === 'function_call') add(item.call_id, item.name, item.arguments)
      if (item.type === 'message') {
        for (const part of records(item.content)) {
          if (part.type === 'output_text' && typeof part.text === 'string') text.push(part.text)
        }
      }
    }
  } else if (protocol === 'anthropic') {
    for (const part of records(value)) {
      if (part.type === 'tool_use') add(part.id, part.name, part.input)
      if (part.type === 'text' && typeof part.text === 'string') text.push(part.text)
    }
  } else if (protocol === 'gemini') {
    for (const part of records(message.parts)) {
      if (isRecordLike(part.functionCall))
        add(part.functionCall.id, part.functionCall.name, part.functionCall.args)
      if (!part.thought && typeof part.text === 'string') text.push(part.text)
    }
  } else {
    for (const part of records(message.content)) {
      if (isRecordLike(part.toolUse))
        add(part.toolUse.toolUseId, part.toolUse.name, part.toolUse.input)
      if (typeof part.text === 'string') text.push(part.text)
    }
  }
  return { assistant: { role: 'assistant', content: text.join('') }, calls }
}

export const providerHistoryAdapters: Record<ConversationProtocol, ProviderHistoryAdapter> = {
  responses: { protocol: 'responses', capture: (value) => capture('responses', value) },
  'chat-completions': {
    protocol: 'chat-completions',
    capture: (value) => capture('chat-completions', value),
  },
  anthropic: { protocol: 'anthropic', capture: (value) => capture('anthropic', value) },
  gemini: { protocol: 'gemini', capture: (value) => capture('gemini', value) },
  bedrock: { protocol: 'bedrock', capture: (value) => capture('bedrock', value) },
}

/**
 * Native history protocol per provider. `null` marks evaluation-only providers; a function
 * resolves per model for providers that proxy more than one wire protocol. Read it through
 * {@link getProviderHistoryProtocol}.
 */
export const providerHistoryProtocols: Record<
  ProviderId,
  ConversationProtocol | null | ((model: string) => ConversationProtocol)
> = {
  openai: 'responses',
  'azure-openai': 'responses',
  anthropic: 'anthropic',
  'azure-anthropic': 'anthropic',
  google: 'gemini',
  vertex: 'gemini',
  bedrock: 'bedrock',
  deepseek: 'chat-completions',
  xai: 'chat-completions',
  cerebras: 'chat-completions',
  groq: 'chat-completions',
  sakana: 'chat-completions',
  typesafe: null,
  nvidia: 'chat-completions',
  meta: 'chat-completions',
  zai: 'chat-completions',
  kimi: 'chat-completions',
  kie: getKieConversationProtocol,
  mistral: 'chat-completions',
  ollama: 'chat-completions',
  'ollama-cloud': 'chat-completions',
  openrouter: 'chat-completions',
  fireworks: 'chat-completions',
  together: 'chat-completions',
  baseten: 'chat-completions',
  vllm: 'chat-completions',
  litellm: 'chat-completions',
}

export function isHistoryProviderId(value: string): value is ProviderId {
  return Object.hasOwn(providerHistoryProtocols, value)
}

export function getProviderHistoryProtocol(
  providerId: ProviderId,
  model: string
): ConversationProtocol | null {
  const protocol = providerHistoryProtocols[providerId]
  return typeof protocol === 'function' ? protocol(model) : protocol
}

/** Bedrock is treated conservatively because its Claude models also require signed thinking. */
export function requiresNativeToolHistory(
  providerId: ProviderId | undefined,
  model: string
): boolean {
  return (
    (providerId === 'kie' && isKieClaudeModel(model)) ||
    providerId === 'anthropic' ||
    providerId === 'azure-anthropic' ||
    providerId === 'bedrock' ||
    providerId === 'google' ||
    providerId === 'vertex' ||
    providerId === 'deepseek'
  )
}
