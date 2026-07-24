import type { ChatCompletionChunk } from 'openai/resources/chat/completions'
import type { CompletionUsage } from 'openai/resources/completions'
import { createOpenAICompatibleAgentEventStream } from '@/providers/openai-compat/stream-events'
import type { AgentStreamEvent } from '@/providers/stream-events'
import { checkForForcedToolUsageOpenAI } from '@/providers/utils'

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
