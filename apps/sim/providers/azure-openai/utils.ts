import type { Logger } from '@sim/logger'
import type { ChatCompletionChunk } from 'openai/resources/chat/completions'
import type { CompletionUsage } from 'openai/resources/completions'
import type { Stream } from 'openai/streaming'
import { checkForForcedToolUsageOpenAI, createOpenAICompatibleStream } from '@/providers/utils'

/**
 * Creates a ReadableStream from an Azure OpenAI streaming response.
 * Uses the shared OpenAI-compatible streaming utility.
 */
export function createReadableStreamFromAzureOpenAIStream(
  azureOpenAIStream: Stream<ChatCompletionChunk>,
  onComplete?: (content: string, usage: CompletionUsage) => void
): ReadableStream {
  return createOpenAICompatibleStream(azureOpenAIStream, 'Azure OpenAI', onComplete)
}

/**
 * Checks if a forced tool was used in an Azure OpenAI response.
 * Uses the shared OpenAI-compatible forced tool usage helper.
 */
export function checkForForcedToolUsage(
  response: any,
  toolChoice: string | { type: string; function?: { name: string }; name?: string; any?: any },
  _logger: Logger,
  forcedTools: string[],
  usedForcedTools: string[]
): { hasUsedForcedTool: boolean; usedForcedTools: string[] } {
  return checkForForcedToolUsageOpenAI(
    response,
    toolChoice,
    'Azure OpenAI',
    forcedTools,
    usedForcedTools,
    _logger
  )
}
