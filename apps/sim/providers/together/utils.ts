import type { ChatCompletionChunk } from 'openai/resources/chat/completions'
import type { CompletionUsage } from 'openai/resources/completions'
import { checkForForcedToolUsageOpenAI, createOpenAICompatibleStream } from '@/providers/utils'

/**
 * Together gates native `json_schema` per-model, so we use the broadly supported
 * JSON-object mode for all models to avoid 400s. See https://docs.together.ai/docs/json-mode.
 */
export async function supportsNativeStructuredOutputs(_modelId: string): Promise<boolean> {
  return false
}

/**
 * Creates a ReadableStream from a Together AI streaming response.
 * Uses the shared OpenAI-compatible streaming utility.
 */
export function createReadableStreamFromOpenAIStream(
  openaiStream: AsyncIterable<ChatCompletionChunk>,
  onComplete?: (content: string, usage: CompletionUsage) => void
): ReadableStream<Uint8Array> {
  return createOpenAICompatibleStream(openaiStream, 'Together', onComplete)
}

/**
 * Checks if a forced tool was used in a Together AI response.
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
    'Together',
    forcedTools,
    usedForcedTools
  )
}
