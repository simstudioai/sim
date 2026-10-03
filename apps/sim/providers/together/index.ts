import { createLogger } from '@sim/logger'
import OpenAI from 'openai'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import type { StreamingExecution } from '@/executor/types'
import { getProviderDefaultModel, getProviderModels } from '@/providers/models'
import {
  type ChatCompletionPayload,
  executeChatCompletionRequest,
} from '@/providers/openai-compat/chat-completions'
import { openAICompatTransport } from '@/providers/transport'
import type { ProviderConfig, ProviderRequest, ProviderResponse } from '@/providers/types'
import { generateSchemaInstructions } from '@/providers/utils'

const logger = createLogger('TogetherProvider')

/** Together uses JSON-object mode because native schema support varies across its models. */
async function applyResponseFormat(
  targetPayload: ChatCompletionPayload,
  messages: ChatCompletionMessageParam[],
  responseFormat: NonNullable<ProviderRequest['responseFormat']>,
  model: string
): Promise<ChatCompletionMessageParam[]> {
  logger.info('Using json_object mode with prompt instructions for Together model', { model })
  const schema = responseFormat.schema || responseFormat
  const schemaInstructions = generateSchemaInstructions(schema, responseFormat.name)
  targetPayload.response_format = { type: 'json_object' }
  return [...messages, { role: 'user', content: schemaInstructions }]
}

export const togetherProvider: ProviderConfig = {
  id: 'together',
  name: 'Together AI',
  description: 'Fast inference for open-source models via Together AI',
  version: '1.0.0',
  models: getProviderModels('together'),
  defaultModel: getProviderDefaultModel('together'),

  executeRequest: async (
    request: ProviderRequest
  ): Promise<ProviderResponse | StreamingExecution> => {
    if (!request.apiKey) {
      throw new Error('API key is required for Together AI')
    }

    const client = new OpenAI({
      ...openAICompatTransport(),
      apiKey: request.apiKey,
      baseURL: 'https://api.together.ai/v1',
    })

    const requestedModel = request.model.replace(/^together\//i, '')

    logger.info('Preparing Together request', {
      model: requestedModel,
      hasSystemPrompt: !!request.systemPrompt,
      hasMessages: !!request.messages?.length,
      hasTools: !!request.tools?.length,
      toolCount: request.tools?.length || 0,
      hasResponseFormat: !!request.responseFormat,
      stream: !!request.stream,
    })

    return executeChatCompletionRequest(request, {
      providerId: 'together',
      providerName: 'Together',
      client,
      requestedModel,
      reportedModel: requestedModel,
      logger,
      applyResponseFormat,
      reasoningFields: ['reasoning', 'reasoning_content'],
      recordPendingUsage: true,
    })
  },
}
