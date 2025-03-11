import { ProviderRequest, ProviderResponse } from './types'
import { generateStructuredOutputInstructions, getProvider } from './utils'

export async function executeProviderRequest(
  providerId: string,
  request: ProviderRequest
): Promise<ProviderResponse> {
  console.log(`[Provider Debug] Executing request with provider: ${providerId}`)
  console.log(`[Provider Debug] Request has responseFormat:`, !!request.responseFormat)

  const provider = getProvider(providerId)
  if (!provider) {
    throw new Error(`Provider not found: ${providerId}`)
  }

  if (!provider.executeRequest) {
    throw new Error(`Provider ${providerId} does not implement executeRequest`)
  }

  // If responseFormat is provided, modify the system prompt to enforce structured output
  if (request.responseFormat) {
    // Handle empty string case
    if (typeof request.responseFormat === 'string' && request.responseFormat === '') {
      console.log(`[Provider Debug] Response format is an empty string, ignoring it`)
      request.responseFormat = undefined
    } else {
      console.log(`[Provider Debug] Response format:`, request.responseFormat)

      const structuredOutputInstructions = generateStructuredOutputInstructions(
        request.responseFormat
      )

      console.log(`[Provider Debug] Generated instructions:`, structuredOutputInstructions)

      // Only add additional instructions if they're not empty
      if (structuredOutputInstructions.trim()) {
        const originalPrompt = request.systemPrompt || ''
        request.systemPrompt = `${originalPrompt}\n\n${structuredOutputInstructions}`.trim()

        console.log(`[Provider Debug] Updated system prompt with instructions`)
      }
    }
  }

  // Execute the request using the provider's implementation
  const response = await provider.executeRequest(request)

  console.log(`[Provider Debug] Provider response:`, {
    contentType: typeof response.content,
    contentLength: response.content ? response.content.length : 0,
    model: response.model,
    hasTokens: !!response.tokens,
    hasToolCalls: !!response.toolCalls,
  })

  return response
}
