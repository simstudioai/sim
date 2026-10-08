import { createLogger } from '@sim/logger'
import OpenAI from 'openai'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import type { StreamingExecution } from '@/executor/types'
import { getProviderDefaultModel, getProviderModels } from '@/providers/models'
import {
  type ChatCompletionPayload,
  executeChatCompletionRequest,
} from '@/providers/openai-compat/chat-completions'
import { buildJsonSchemaResponseFormat } from '@/providers/response-format'
import { openAICompatTransport } from '@/providers/transport'
import type { ProviderConfig, ProviderRequest, ProviderResponse } from '@/providers/types'

const logger = createLogger('AtlasCloudProvider')

/** Atlas Cloud accepts native JSON schemas. */
async function applyResponseFormat(
  targetPayload: ChatCompletionPayload,
  messages: ChatCompletionMessageParam[],
  responseFormat: NonNullable<ProviderRequest['responseFormat']>,
  model: string
): Promise<ChatCompletionMessageParam[]> {
  logger.info('Using native structured outputs for Atlas Cloud model', { model })
  targetPayload.response_format = buildJsonSchemaResponseFormat(responseFormat, {
    includeStrict: false,
  })
  return messages
}

export const atlascloudProvider: ProviderConfig = {
  id: 'atlascloud',
  name: 'Atlas Cloud',
  description: 'One key for DeepSeek, GLM, Kimi, Qwen and MiniMax via Atlas Cloud',
  version: '1.0.0',
  models: getProviderModels('atlascloud'),
  defaultModel: getProviderDefaultModel('atlascloud'),

  executeRequest: async (
    request: ProviderRequest
  ): Promise<ProviderResponse | StreamingExecution> => {
    if (!request.apiKey) {
      throw new Error('API key is required for Atlas Cloud')
    }

    const client = new OpenAI({
      ...openAICompatTransport(),
      apiKey: request.apiKey,
      baseURL: 'https://api.atlascloud.ai/v1',
    })

    const requestedModel = request.model.replace(/^atlascloud\//i, '')

    logger.info('Preparing Atlas Cloud request', {
      model: requestedModel,
      hasSystemPrompt: !!request.systemPrompt,
      hasMessages: !!request.messages?.length,
      hasTools: !!request.tools?.length,
      toolCount: request.tools?.length || 0,
      hasResponseFormat: !!request.responseFormat,
      stream: !!request.stream,
    })

    return executeChatCompletionRequest(request, {
      providerId: 'atlascloud',
      providerName: 'Atlas Cloud',
      client,
      requestedModel,
      reportedModel: requestedModel,
      logger,
      applyResponseFormat,
      reasoningFields: ['reasoning_content'],
    })
  },
}
