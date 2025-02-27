import { Cerebras } from '@cerebras/cerebras_cloud_sdk'
import { ProviderRequest, ProviderResponse } from '../types'
import { cerebrasProvider } from './index'

// This function will be used to execute Cerebras requests locally using their SDK
export async function executeCerebrasRequest(request: ProviderRequest): Promise<ProviderResponse> {
  try {
    const client = new Cerebras({
      apiKey: request.apiKey,
    })

    // Transform the request using the provider's transformRequest method
    const payload = cerebrasProvider.transformRequest(request)

    // Prepare the messages for the SDK
    const messages = payload.messages

    // Prepare the options for the SDK
    const options = {
      temperature: payload.temperature,
      max_tokens: payload.max_tokens,
      functions: payload.functions,
      function_call: payload.function_call,
    }

    // Execute the request using the SDK
    const response = await client.chat.completions.create({
      model: payload.model,
      messages,
      ...options,
    })

    // Transform the response using the provider's transformResponse method
    const transformedResponse = cerebrasProvider.transformResponse(response)

    // Check for function calls
    const hasFunctionCall = cerebrasProvider.hasFunctionCall(response)
    let toolCalls = undefined

    if (hasFunctionCall) {
      const functionCall = cerebrasProvider.transformFunctionCallResponse(response, request.tools)
      toolCalls = [functionCall]
    }

    // Return the response in the expected format
    return {
      content: transformedResponse.content,
      model: request.model,
      tokens: transformedResponse.tokens,
      toolCalls,
    }
  } catch (error: any) {
    console.error('Error executing Cerebras request:', error)
    throw new Error(`Cerebras API error: ${error.message}`)
  }
}
