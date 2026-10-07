import { createLogger } from '@sim/logger'
import OpenAI from 'openai'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import type { StreamingExecution } from '@/executor/types'
import {
  getModelCapabilities,
  getProviderDefaultModel,
  getProviderModels,
} from '@/providers/models'
import {
  type ChatCompletionPayload,
  executeChatCompletionRequest,
} from '@/providers/openai-compat/chat-completions'
import { buildJsonSchemaResponseFormat } from '@/providers/response-format'
import { openAICompatTransport } from '@/providers/transport'
import type { ProviderConfig, ProviderRequest, ProviderResponse } from '@/providers/types'
import { generateSchemaInstructions } from '@/providers/utils'

const logger = createLogger('NebiusProvider')

/** Uses native schemas only for models carrying Nebius's JSON-mode catalog tag. */
async function applyResponseFormat(
  payload: ChatCompletionPayload,
  messages: ChatCompletionMessageParam[],
  responseFormat: NonNullable<ProviderRequest['responseFormat']>,
  model: string
): Promise<ChatCompletionMessageParam[]> {
  if (getModelCapabilities(`nebius/${model}`)?.nativeStructuredOutputs) {
    payload.response_format = buildJsonSchemaResponseFormat(responseFormat)
    return messages
  }
  return [
    ...messages,
    {
      role: 'user',
      content: generateSchemaInstructions(responseFormat.schema, responseFormat.name),
    },
  ]
}

export const nebiusProvider: ProviderConfig = {
  id: 'nebius',
  name: 'Nebius',
  description: 'Open models via Nebius Token Factory',
  version: '1.0.0',
  models: getProviderModels('nebius'),
  defaultModel: getProviderDefaultModel('nebius'),
  executeRequest: async (
    request: ProviderRequest
  ): Promise<ProviderResponse | StreamingExecution> => {
    if (!request.apiKey) throw new Error('API key is required for Nebius')
    const client = new OpenAI({
      ...openAICompatTransport(),
      apiKey: request.apiKey,
      baseURL: 'https://api.tokenfactory.nebius.com/v1',
    })
    const catalogModel = getProviderModels('nebius').find(
      (model) => model.toLowerCase() === request.model.toLowerCase()
    )
    const requestedModel = (catalogModel ?? request.model).replace(/^nebius\//i, '')
    return executeChatCompletionRequest(request, {
      providerId: 'nebius',
      providerName: 'Nebius',
      client,
      requestedModel,
      reportedModel: request.model,
      logger,
      applyResponseFormat,
      reasoningFields: ['reasoning_content', 'reasoning'],
      recordPendingUsage: true,
    })
  },
}
