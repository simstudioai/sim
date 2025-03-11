import { ProviderRequest, ProviderResponse } from './types'
import { generateStructuredOutputInstructions, getProvider } from './utils'

export async function executeProviderRequest(
  providerId: string,
  request: ProviderRequest
): Promise<ProviderResponse> {
  const provider = getProvider(providerId)
  if (!provider) {
    throw new Error(`Provider not found: ${providerId}`)
  }

  if (!provider.executeRequest) {
    throw new Error(`Provider ${providerId} does not implement executeRequest`)
  }

  // If responseFormat is provided, modify the system prompt to enforce structured output
  if (request.responseFormat) {
    const structuredOutputInstructions = generateStructuredOutputInstructions(
      request.responseFormat
    )

    // Only add additional instructions if they're not empty
    if (structuredOutputInstructions.trim()) {
      request.systemPrompt =
        `${request.systemPrompt || ''}\n\n${structuredOutputInstructions}`.trim()
    }
  }

  // Execute the request using the provider's implementation
  return await provider.executeRequest(request)
}
