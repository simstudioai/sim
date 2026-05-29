import type { ChatCompletionChunk } from 'openai/resources/chat/completions'
import type { CompletionUsage } from 'openai/resources/completions'
import { checkForForcedToolUsageOpenAI, createOpenAICompatibleStream } from '@/providers/utils'

/**
 * Checks if a model supports native structured outputs (json_schema).
 * Fireworks AI supports structured outputs across their inference API.
 */
export async function supportsNativeStructuredOutputs(_modelId: string): Promise<boolean> {
  return true
}

/**
 * Creates a ReadableStream from a Fireworks streaming response.
 * Uses the shared OpenAI-compatible streaming utility.
 */
export function createReadableStreamFromOpenAIStream(
  openaiStream: AsyncIterable<ChatCompletionChunk>,
  onComplete?: (content: string, usage: CompletionUsage) => void
): ReadableStream<Uint8Array> {
  return createOpenAICompatibleStream(openaiStream, 'Fireworks', onComplete)
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
