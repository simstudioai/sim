import type { BlockTokens, IterationToolCall, ProviderTimingSegment } from '@/executor/types'
import { calculateCost } from '@/providers/utils'

/**
 * Minimal structural shape shared by OpenAI Chat Completions and every
 * OpenAI-compatible SDK (Groq, Cerebras, DeepSeek, xAI, Mistral, Ollama,
 * OpenRouter, vLLM, Fireworks). Captures only the fields the trace enrichment
 * helper reads, so providers can pass their own SDK's response type without
 * a cast.
 */
interface ChatCompletionLike {
  choices: Array<{
    message?: {
      content?: string | null
      tool_calls?: Array<ChatCompletionToolCallLike> | null
    } | null
    finish_reason?: string | null
  } | null>
  usage?: {
    prompt_tokens?: number | null
    completion_tokens?: number | null
    total_tokens?: number | null
    prompt_tokens_details?: { cached_tokens?: number | null } | null
    completion_tokens_details?: { reasoning_tokens?: number | null } | null
    /** DeepSeek's legacy cache shape (not nested under prompt_tokens_details). */
    prompt_cache_hit_tokens?: number | null
  } | null
}

interface ChatCompletionToolCallLike {
  id: string
  function: { name: string; arguments: string }
}

/**
 * Content to attach to a model segment for a single provider iteration.
 * All fields are optional — providers populate what the response carries.
 */
export interface ModelSegmentContent {
  assistantContent?: string
  thinkingContent?: string
  toolCalls?: IterationToolCall[]
  finishReason?: string
  tokens?: BlockTokens
  cost?: { input?: number; output?: number; total?: number }
  ttft?: number
  provider?: string
  errorType?: string
  errorMessage?: string
}

/**
 * Enriches the most recent `type: 'model'` segment in `timeSegments` with
 * content from the model response for that iteration. Writes only the fields
 * provided; undefined fields are skipped so repeat calls can layer data.
 *
 * Call at the point where the response for the latest model segment is in hand
 * — typically right after the provider call returns, before tool execution.
 */
export function enrichLastModelSegment(
  timeSegments: ProviderTimingSegment[],
  content: ModelSegmentContent
): void {
  for (let i = timeSegments.length - 1; i >= 0; i--) {
    const segment = timeSegments[i]
    if (segment.type !== 'model') continue

    if (content.assistantContent !== undefined) {
      segment.assistantContent = content.assistantContent
    }
    if (content.thinkingContent !== undefined) {
      segment.thinkingContent = content.thinkingContent
    }
    if (content.toolCalls !== undefined) {
      segment.toolCalls = content.toolCalls
    }
    if (content.finishReason !== undefined) {
      segment.finishReason = content.finishReason
    }
    if (content.tokens !== undefined) {
      segment.tokens = content.tokens
    }
    if (content.cost !== undefined) {
      segment.cost = content.cost
    }
    if (content.ttft !== undefined) {
      segment.ttft = content.ttft
    }
    if (content.provider !== undefined) {
      segment.provider = content.provider
    }
    if (content.errorType !== undefined) {
      segment.errorType = content.errorType
    }
    if (content.errorMessage !== undefined) {
      segment.errorMessage = content.errorMessage
    }
    return
  }
}

/**
 * Parses a tool call's `function.arguments` JSON string into an object, or
 * returns the raw string if it is not valid JSON.
 */
function parseToolCallArguments(rawArguments: string): Record<string, unknown> | string {
  try {
    const parsed = JSON.parse(rawArguments)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return rawArguments
  } catch {
    return rawArguments
  }
}

/**
 * Extracts reasoning/thinking content from a Chat Completions message. Covers
 * non-OpenAI extensions emitted by reasoning-capable providers:
 * - `reasoning_content`: DeepSeek, xAI, vLLM, Fireworks
 * - `reasoning`: Groq, Cerebras, OpenRouter (flat)
 * - `reasoning_details[]`: OpenRouter (structured per-block reasoning)
 */
function extractChatCompletionsReasoning(
  message: NonNullable<ChatCompletionLike['choices'][number]>['message']
): string | undefined {
  if (!message) return undefined
  const msg = message as unknown as {
    reasoning_content?: string | null
    reasoning?: string | null
    reasoning_details?: Array<{ text?: string | null; summary?: string | null } | null> | null
  }

  if (typeof msg.reasoning_content === 'string' && msg.reasoning_content.length > 0) {
    return msg.reasoning_content
  }
  if (typeof msg.reasoning === 'string' && msg.reasoning.length > 0) {
    return msg.reasoning
  }
  if (Array.isArray(msg.reasoning_details)) {
    const joined = msg.reasoning_details
      .map((d) => d?.text ?? d?.summary ?? '')
      .filter((s): s is string => typeof s === 'string' && s.length > 0)
      .join('\n')
    if (joined.length > 0) return joined
  }
  return undefined
}

/**
 * Enriches the last model segment with per-iteration content from a Chat
 * Completions response: assistant text, thinking/reasoning, tool calls, finish
 * reason, token usage. Shared by all OpenAI-compat providers.
 */
export function enrichLastModelSegmentFromChatCompletions(
  timeSegments: ProviderTimingSegment[],
  response: ChatCompletionLike,
  toolCallsInResponse: ChatCompletionToolCallLike[] | undefined,
  extras?: {
    /** Model id used for this call — enables automatic cost calculation. */
    model?: string
    /** Provider system identifier (`gen_ai.system`). */
    provider?: string
    /** Time-to-first-token in ms (streaming path only). */
    ttft?: number
    /** Structured error class when the call failed. */
    errorType?: string
    /** Human-readable error message when the call failed. */
    errorMessage?: string
    /** Override the automatically derived cost. */
    cost?: { input?: number; output?: number; total?: number }
  }
): void {
  const choice = response.choices[0]
  const assistantText = choice?.message?.content ?? ''
  const thinkingText = extractChatCompletionsReasoning(choice?.message)

  const toolCalls: IterationToolCall[] = (toolCallsInResponse ?? []).map((tc) => ({
    id: tc.id,
    name: tc.function.name,
    arguments: parseToolCallArguments(tc.function.arguments),
  }))

  const usage = response.usage
  const cacheRead =
    usage?.prompt_tokens_details?.cached_tokens ?? usage?.prompt_cache_hit_tokens ?? 0
  const reasoning = usage?.completion_tokens_details?.reasoning_tokens ?? 0

  const promptTokens = usage?.prompt_tokens ?? undefined
  const completionTokens = usage?.completion_tokens ?? undefined

  let derivedCost = extras?.cost
  if (!derivedCost && extras?.model && promptTokens != null && completionTokens != null) {
    const full = calculateCost(extras.model, promptTokens, completionTokens, cacheRead > 0)
    derivedCost = { input: full.input, output: full.output, total: full.total }
  }

  enrichLastModelSegment(timeSegments, {
    assistantContent: assistantText || undefined,
    thinkingContent: thinkingText,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    finishReason: choice?.finish_reason ?? undefined,
    tokens: usage
      ? {
          input: promptTokens,
          output: completionTokens,
          total: usage.total_tokens ?? undefined,
          ...(cacheRead > 0 && { cacheRead }),
          ...(reasoning > 0 && { reasoning }),
        }
      : undefined,
    cost: derivedCost,
    ttft: extras?.ttft,
    provider: extras?.provider,
    errorType: extras?.errorType,
    errorMessage: extras?.errorMessage,
  })
}

export { parseToolCallArguments }
