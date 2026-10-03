import { createLogger } from '@sim/logger'
import OpenAI from 'openai'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import type { StreamingExecution } from '@/executor/types'
import { bindConversationGenerationContextWindow } from '@/providers/conversation-generation'
import { getConversationRequestContext } from '@/providers/conversation-history'
import { getProviderDefaultModel, getProviderModels } from '@/providers/models'
import {
  type ChatCompletionPayload,
  executeChatCompletionRequest,
} from '@/providers/openai-compat/chat-completions'
import {
  getOpenRouterModelCapabilities,
  supportsNativeStructuredOutputs,
} from '@/providers/openrouter/utils'
import { buildJsonSchemaResponseFormat } from '@/providers/response-format'
import { openAICompatTransport } from '@/providers/transport'
import type { ProviderConfig, ProviderRequest, ProviderResponse } from '@/providers/types'
import { generateSchemaInstructions } from '@/providers/utils'

const logger = createLogger('OpenRouterProvider')

/**
 * Applies structured output configuration to a payload based on model capabilities.
 * Uses json_schema with require_parameters for supported models, falls back to json_object with prompt instructions.
 */
async function applyResponseFormat(
  targetPayload: ChatCompletionPayload,
  messages: ChatCompletionMessageParam[],
  responseFormat: NonNullable<ProviderRequest['responseFormat']>,
  model: string
): Promise<ChatCompletionMessageParam[]> {
  const useNative = await supportsNativeStructuredOutputs(model)

  if (useNative) {
    logger.info('Using native structured outputs for OpenRouter model', { model })
    targetPayload.response_format = buildJsonSchemaResponseFormat(responseFormat)
    targetPayload.provider = { ...targetPayload.provider, require_parameters: true }
    return messages
  }

  logger.info('Using json_object mode with prompt instructions for OpenRouter model', { model })
  const schema = responseFormat.schema || responseFormat
  const schemaInstructions = generateSchemaInstructions(schema, responseFormat.name)
  targetPayload.response_format = { type: 'json_object' }
  return [...messages, { role: 'user', content: schemaInstructions }]
}

export const openRouterProvider: ProviderConfig = {
  id: 'openrouter',
  name: 'OpenRouter',
  description: 'Unified access to many models via OpenRouter',
  version: '1.0.0',
  models: getProviderModels('openrouter'),
  defaultModel: getProviderDefaultModel('openrouter'),

  executeRequest: async (
    request: ProviderRequest
  ): Promise<ProviderResponse | StreamingExecution> => {
    if (!request.apiKey) {
      throw new Error('API key is required for OpenRouter')
    }

    if (getConversationRequestContext(request)?.agentConversation) {
      const capabilities = await getOpenRouterModelCapabilities(request.model, request.abortSignal)
      if (capabilities?.contextWindow)
        bindConversationGenerationContextWindow(request, capabilities.contextWindow)
    }

    const client = new OpenAI({
      ...openAICompatTransport(),
      apiKey: request.apiKey,
      baseURL: 'https://openrouter.ai/api/v1',
    })

    const requestedModel = request.model.replace(/^openrouter\//i, '')

    logger.info('Preparing OpenRouter request', {
      model: requestedModel,
      hasSystemPrompt: !!request.systemPrompt,
      hasMessages: !!request.messages?.length,
      hasTools: !!request.tools?.length,
      toolCount: request.tools?.length || 0,
      hasResponseFormat: !!request.responseFormat,
      stream: !!request.stream,
    })

    return executeChatCompletionRequest(request, {
      providerId: 'openrouter',
      providerName: 'OpenRouter',
      client,
      requestedModel,
      reportedModel: requestedModel,
      logger,
      applyResponseFormat,
      reasoningFields: ['reasoning', 'reasoning_content'],
      preserveReasoningDetails: true,
      recordPendingUsage: true,
    })
  },
}
