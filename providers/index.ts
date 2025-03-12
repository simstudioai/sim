import { supportsTemperature } from './model-capabilities'
import { ProviderRequest, ProviderResponse } from './types'
import { generateStructuredOutputInstructions, getProvider, getProviderFromModel } from './utils'

// Sanitize the request by removing parameters that aren't supported by the model
function sanitizeRequest(request: ProviderRequest): ProviderRequest {
  // Create a shallow copy of the request
  const sanitizedRequest = { ...request }

  // Remove temperature if the model doesn't support it
  if (sanitizedRequest.model && !supportsTemperature(sanitizedRequest.model)) {
    delete sanitizedRequest.temperature
  }

  return sanitizedRequest
}

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

  const sanitizedRequest = sanitizeRequest(request)

  // If responseFormat is provided, modify the system prompt to enforce structured output
  if (sanitizedRequest.responseFormat) {
    if (
      typeof sanitizedRequest.responseFormat === 'string' &&
      sanitizedRequest.responseFormat === ''
    ) {
      console.log(`[Provider Debug] Response format is an empty string, ignoring it`)
      sanitizedRequest.responseFormat = undefined
    } else {
      console.log(`[Provider Debug] Response format:`, sanitizedRequest.responseFormat)

      const structuredOutputInstructions = generateStructuredOutputInstructions(
        sanitizedRequest.responseFormat
      )

      console.log(`[Provider Debug] Generated instructions:`, structuredOutputInstructions)

      // Only add additional instructions if they're not empty
      if (structuredOutputInstructions.trim()) {
        const originalPrompt = sanitizedRequest.systemPrompt || ''
        sanitizedRequest.systemPrompt =
          `${originalPrompt}\n\n${structuredOutputInstructions}`.trim()

        console.log(`[Provider Debug] Updated system prompt with instructions`)
      }
    }
  }

  // Execute the request using the provider's implementation
  const response = await provider.executeRequest(sanitizedRequest)

  console.log(`[Provider Debug] Provider response:`, {
    contentType: typeof response.content,
    contentLength: response.content ? response.content.length : 0,
    model: response.model,
    hasTokens: !!response.tokens,
    hasToolCalls: !!response.toolCalls,
  })

  return response
}
