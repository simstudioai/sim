import type { Logger } from '@sim/logger'
import type OpenAI from 'openai'
import type {
  ChatCompletionChunk,
  ChatCompletionContentPart,
  ChatCompletionMessageParam,
  ChatCompletionUserMessageParam,
} from 'openai/resources/chat/completions'
import type { CompletionUsage } from 'openai/resources/completions'
import type { Stream } from 'openai/streaming'
import { buildChatCompletionFileParts } from '@/providers/openai/utils'
import type { ProviderFileAttachment } from '@/providers/types'
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
  response: OpenAI.Chat.Completions.ChatCompletion,
  toolChoice: string | { type: string; function?: { name: string }; name?: string },
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

function isUserMessage(
  message: ChatCompletionMessageParam
): message is ChatCompletionUserMessageParam {
  return message.role === 'user'
}

function createTextPart(text: string): ChatCompletionContentPart {
  return {
    type: 'text',
    text,
  }
}

/**
 * Adds supported file attachments to the latest user message for Azure Chat Completions.
 */
export function appendFileAttachmentsToChatCompletionMessages(
  messages: ChatCompletionMessageParam[],
  fileAttachments?: ProviderFileAttachment[]
): void {
  const fileParts = buildChatCompletionFileParts(fileAttachments)
  if (fileParts.length === 0) return

  const lastUserMessage = [...messages].reverse().find(isUserMessage)
  if (!lastUserMessage) {
    messages.push({
      role: 'user',
      content: [createTextPart('Please use the attached files.'), ...fileParts],
    })
    return
  }

  lastUserMessage.content = Array.isArray(lastUserMessage.content)
    ? [...lastUserMessage.content, ...fileParts]
    : [createTextPart(lastUserMessage.content || 'Please use the attached files.'), ...fileParts]
}

/**
 * Determines if an Azure OpenAI endpoint URL is for the chat completions API.
 * Returns true for URLs containing /chat/completions pattern.
 *
 * @param endpoint - The Azure OpenAI endpoint URL
 * @returns true if the endpoint is for chat completions API
 */
export function isChatCompletionsEndpoint(endpoint: string): boolean {
  const normalizedEndpoint = endpoint.toLowerCase()
  return normalizedEndpoint.includes('/chat/completions')
}

/**
 * Determines if an Azure OpenAI endpoint URL is already a complete responses API URL.
 * Returns true for URLs containing /responses pattern (but not /chat/completions).
 *
 * @param endpoint - The Azure OpenAI endpoint URL
 * @returns true if the endpoint is already a responses API URL
 */
export function isResponsesEndpoint(endpoint: string): boolean {
  const normalizedEndpoint = endpoint.toLowerCase()
  return (
    normalizedEndpoint.includes('/responses') && !normalizedEndpoint.includes('/chat/completions')
  )
}

/**
 * Extracts the base URL from a full Azure OpenAI chat completions URL.
 * For example:
 *   Input: https://resource.openai.azure.com/openai/deployments/gpt-4/chat/completions?api-version=2024-01-01
 *   Output: https://resource.openai.azure.com
 *
 * @param fullUrl - The full chat completions URL
 * @returns The base URL (scheme + host)
 */
export function extractBaseUrl(fullUrl: string): string {
  try {
    const url = new URL(fullUrl)
    return `${url.protocol}//${url.host}`
  } catch {
    // If parsing fails, try to extract up to .com or .azure.com
    const match = fullUrl.match(/^(https?:\/\/[^/]+)/)
    return match ? match[1] : fullUrl
  }
}

/**
 * Extracts the deployment name from a full Azure OpenAI URL.
 * For example:
 *   Input: https://resource.openai.azure.com/openai/deployments/gpt-4.1-mini/chat/completions?api-version=2024-01-01
 *   Output: gpt-4.1-mini
 *
 * @param fullUrl - The full Azure OpenAI URL
 * @returns The deployment name or null if not found
 */
export function extractDeploymentFromUrl(fullUrl: string): string | null {
  // Match /deployments/{deployment-name}/ pattern
  const match = fullUrl.match(/\/deployments\/([^/]+)/i)
  return match ? match[1] : null
}

/**
 * Extracts the api-version from a full Azure OpenAI URL query string.
 * For example:
 *   Input: https://resource.openai.azure.com/openai/deployments/gpt-4/chat/completions?api-version=2025-01-01-preview
 *   Output: 2025-01-01-preview
 *
 * @param fullUrl - The full Azure OpenAI URL
 * @returns The api-version or null if not found
 */
export function extractApiVersionFromUrl(fullUrl: string): string | null {
  try {
    const url = new URL(fullUrl)
    return url.searchParams.get('api-version')
  } catch {
    // Fallback regex for malformed URLs
    const match = fullUrl.match(/[?&]api-version=([^&]+)/i)
    return match ? match[1] : null
  }
}
