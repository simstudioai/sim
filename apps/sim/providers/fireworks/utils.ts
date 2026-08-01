import type { ChatCompletionChunk } from 'openai/resources/chat/completions'
import type { CompletionUsage } from 'openai/resources/completions'
import { createOpenAICompatibleAgentEventStream } from '@/providers/openai-compat/stream-events'
import type { AgentStreamEvent } from '@/providers/stream-events'
import { checkForForcedToolUsageOpenAI } from '@/providers/utils'

/**
 * Wire model names for the static hosted Fireworks catalog entries (the
 * sim-auto pool). Catalog ids are the short `fireworks/<name>` form; the
 * Fireworks API requires the full serverless resource path. User-configured
 * dynamic ids are sent verbatim after prefix-stripping, exactly as before —
 * only ids in this map are rewritten.
 */
const FIREWORKS_WIRE_NAMES: Record<string, string> = {
  'glm-5.2': 'accounts/fireworks/models/glm-5p2',
  'kimi-k3': 'accounts/fireworks/models/kimi-k3',
}

/**
 * Resolves the wire model name Fireworks expects from a prefix-stripped
 * catalog id.
 */
export function resolveFireworksWireModel(strippedModel: string): string {
  return FIREWORKS_WIRE_NAMES[strippedModel] ?? strippedModel
}

/**
 * Checks if a model supports native structured outputs (json_schema).
 * Fireworks AI supports structured outputs across their inference API.
 */
export async function supportsNativeStructuredOutputs(_modelId: string): Promise<boolean> {
  return true
}

/**
 * Creates an agent-events stream from a Fireworks streaming response.
 * Uses the shared OpenAI-compatible agent event streaming utility.
 */
export function createReadableStreamFromOpenAIStream(
  openaiStream: AsyncIterable<ChatCompletionChunk>,
  onComplete?: (content: string, usage: CompletionUsage, thinking?: string) => void
): ReadableStream<AgentStreamEvent> {
  return createOpenAICompatibleAgentEventStream(openaiStream, {
    providerName: 'Fireworks',
    onComplete: onComplete
      ? (result) => onComplete(result.content, result.usage, result.thinking)
      : undefined,
  })
}

/**
 * Checks if a forced tool was used in a Fireworks response.
 * Uses the shared OpenAI-compatible forced tool usage helper.
 */
export function checkForForcedToolUsage(
  response: any,
  toolChoice: string | { type: string; function?: { name: string }; name?: string; any?: any },
  forcedTools: string[],
  usedForcedTools: string[]
): { hasUsedForcedTool: boolean; usedForcedTools: string[] } {
  return checkForForcedToolUsageOpenAI(
    response,
    toolChoice,
    'Fireworks',
    forcedTools,
    usedForcedTools
  )
}
