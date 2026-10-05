import { createLogger } from '@sim/logger'
import OpenAI from 'openai'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import type { StreamingExecution } from '@/executor/types'
import { resolveFireworksWireModel } from '@/providers/fireworks/utils'
import { getProviderDefaultModel, getProviderModels } from '@/providers/models'
import {
  type ChatCompletionPayload,
  executeChatCompletionRequest,
} from '@/providers/openai-compat/chat-completions'
import { buildJsonSchemaResponseFormat } from '@/providers/response-format'
import { openAICompatTransport } from '@/providers/transport'
import type { ProviderConfig, ProviderRequest, ProviderResponse } from '@/providers/types'

const logger = createLogger('FireworksProvider')

/** Fireworks accepts native JSON schemas. */
async function applyResponseFormat(
  targetPayload: ChatCompletionPayload,
  messages: ChatCompletionMessageParam[],
  responseFormat: NonNullable<ProviderRequest['responseFormat']>,
  model: string
): Promise<ChatCompletionMessageParam[]> {
  logger.info('Using native structured outputs for Fireworks model', { model })
  targetPayload.response_format = buildJsonSchemaResponseFormat(responseFormat, {
    includeStrict: false,
  })
  return messages
}

export const fireworksProvider: ProviderConfig = {
  id: 'fireworks',
  name: 'Fireworks',
  description: 'Fast inference for open-source models via Fireworks AI',
  version: '1.0.0',
  models: getProviderModels('fireworks'),
  defaultModel: getProviderDefaultModel('fireworks'),

  executeRequest: async (
    request: ProviderRequest
  ): Promise<ProviderResponse | StreamingExecution> => {
    if (!request.apiKey) {
      throw new Error('API key is required for Fireworks')
    }

    const client = new OpenAI({
      ...openAICompatTransport(),
      apiKey: request.apiKey,
      baseURL: 'https://api.fireworks.ai/inference/v1',
    })

    const requestedModel = resolveFireworksWireModel(request.model.replace(/^fireworks\//i, ''))

    logger.info('Preparing Fireworks request', {
      model: requestedModel,
      hasSystemPrompt: !!request.systemPrompt,
      hasMessages: !!request.messages?.length,
      hasTools: !!request.tools?.length,
      toolCount: request.tools?.length || 0,
      hasResponseFormat: !!request.responseFormat,
      stream: !!request.stream,
    })

    return executeChatCompletionRequest(request, {
      providerId: 'fireworks',
      providerName: 'Fireworks',
      client,
      requestedModel,
      reportedModel: request.model,
      logger,
      applyResponseFormat,
      reasoningFields: ['reasoning_content'],
    })
  },
}
