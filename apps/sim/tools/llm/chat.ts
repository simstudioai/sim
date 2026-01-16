import { createLogger } from '@sim/logger'
import { getProviderFromModel } from '@/providers/utils'
import type { ToolConfig, ToolResponse } from '@/tools/types'

const logger = createLogger('LLMChatTool')

interface LLMChatParams {
  model: string
  systemPrompt?: string
  context: string
  apiKey?: string
  temperature?: number
  maxTokens?: number
  azureEndpoint?: string
  azureApiVersion?: string
  vertexProject?: string
  vertexLocation?: string
  vertexCredential?: string
  bedrockAccessKeyId?: string
  bedrockSecretKey?: string
  bedrockRegion?: string
}

interface LLMChatResponse extends ToolResponse {
  output: {
    content: string
    model: string
    tokens?: {
      prompt?: number
      completion?: number
      total?: number
    }
  }
}

export const llmChatTool: ToolConfig<LLMChatParams, LLMChatResponse> = {
  id: 'llm_chat',
  name: 'LLM Chat',
  description: 'Send a chat completion request to any supported LLM provider',
  version: '1.0.0',

  params: {
    model: {
      type: 'string',
      required: true,
      description: 'The model to use (e.g., gpt-4o, claude-sonnet-4-5, gemini-2.0-flash)',
    },
    systemPrompt: {
      type: 'string',
      required: false,
      description: 'System prompt to set the behavior of the assistant',
    },
    context: {
      type: 'string',
      required: true,
      description: 'The user message or context to send to the model',
    },
    apiKey: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'API key for the provider (uses platform key if not provided for hosted models)',
    },
    temperature: {
      type: 'number',
      required: false,
      description: 'Temperature for response generation (0-2)',
    },
    maxTokens: {
      type: 'number',
      required: false,
      description: 'Maximum tokens in the response',
    },
    azureEndpoint: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'Azure OpenAI endpoint URL',
    },
    azureApiVersion: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'Azure OpenAI API version',
    },
    vertexProject: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'Google Cloud project ID for Vertex AI',
    },
    vertexLocation: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'Google Cloud location for Vertex AI (defaults to us-central1)',
    },
    vertexCredential: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'Google Cloud OAuth credential ID for Vertex AI',
    },
    bedrockAccessKeyId: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'AWS Access Key ID for Bedrock',
    },
    bedrockSecretKey: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'AWS Secret Access Key for Bedrock',
    },
    bedrockRegion: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'AWS region for Bedrock (defaults to us-east-1)',
    },
  },

  request: {
    url: () => '/api/providers',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const provider = getProviderFromModel(params.model)

      return {
        provider,
        model: params.model,
        systemPrompt: params.systemPrompt,
        context: JSON.stringify([{ role: 'user', content: params.context }]),
        apiKey: params.apiKey,
        temperature: params.temperature,
        maxTokens: params.maxTokens,
        azureEndpoint: params.azureEndpoint,
        azureApiVersion: params.azureApiVersion,
        vertexProject: params.vertexProject,
        vertexLocation: params.vertexLocation,
        vertexCredential: params.vertexCredential,
        bedrockAccessKeyId: params.bedrockAccessKeyId,
        bedrockSecretKey: params.bedrockSecretKey,
        bedrockRegion: params.bedrockRegion,
      }
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      const errorMessage = errorData.error || `LLM API error: ${response.status}`
      logger.error('LLM chat request failed', { error: errorMessage })
      throw new Error(errorMessage)
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        content: data.content,
        model: data.model,
        tokens: data.tokens,
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'The generated response content' },
    model: { type: 'string', description: 'The model used for generation' },
    tokens: { type: 'object', description: 'Token usage information' },
  },
}
