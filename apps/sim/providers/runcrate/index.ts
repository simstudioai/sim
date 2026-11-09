import { createLogger } from '@sim/logger'
import OpenAI from 'openai'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import type { StreamingExecution } from '@/executor/types'
import {
  getProviderDefaultModel,
  getProviderModels,
  supportsForcedToolUse,
} from '@/providers/models'
import {
  type ChatCompletionPayload,
  executeChatCompletionRequest,
} from '@/providers/openai-compat/chat-completions'
import { buildJsonSchemaResponseFormat } from '@/providers/response-format'
import { openAICompatTransport } from '@/providers/transport'
import type { ProviderConfig, ProviderRequest, ProviderResponse } from '@/providers/types'

const logger = createLogger('RuncrateProvider')

/** Runcrate accepts strict JSON schemas on every catalog model. */
async function applyResponseFormat(
  payload: ChatCompletionPayload,
  messages: ChatCompletionMessageParam[],
  responseFormat: NonNullable<ProviderRequest['responseFormat']>
): Promise<ChatCompletionMessageParam[]> {
  payload.response_format = buildJsonSchemaResponseFormat(responseFormat)
  return messages
}

/**
 * Runcrate provider for the OpenAI-compatible inference API at `api.runcrate.ai`.
 * Requires an API key (workspace key or block-level). Named tool choice is downgraded
 * to `auto` on models that cannot honor it.
 */
export const runcrateProvider: ProviderConfig = {
  id: 'runcrate',
  name: 'Runcrate',
  description: 'Open models via the Runcrate inference API',
  version: '1.0.0',
  models: getProviderModels('runcrate'),
  defaultModel: getProviderDefaultModel('runcrate'),
  executeRequest: async (
    request: ProviderRequest
  ): Promise<ProviderResponse | StreamingExecution> => {
    if (!request.apiKey) throw new Error('API key is required for Runcrate')
    const client = new OpenAI({
      ...openAICompatTransport(),
      apiKey: request.apiKey,
      baseURL: 'https://api.runcrate.ai/v1',
    })
    const catalogModel = getProviderModels('runcrate').find(
      (model) => model.toLowerCase() === request.model.toLowerCase()
    )
    const requestedModel = (catalogModel ?? request.model).replace(/^runcrate\//i, '')
    // Runcrate rejects a named tool_choice on models that cannot honor it, so downgrade to auto.
    const tools = supportsForcedToolUse(`runcrate/${requestedModel}`)
      ? request.tools
      : request.tools?.map((tool) =>
          tool.usageControl === 'force' ? { ...tool, usageControl: 'auto' as const } : tool
        )
    return executeChatCompletionRequest(
      { ...request, tools },
      {
        providerId: 'runcrate',
        providerName: 'Runcrate',
        client,
        requestedModel,
        reportedModel: request.model,
        logger,
        applyResponseFormat,
        reasoningFields: ['reasoning_content', 'reasoning'],
        recordPendingUsage: true,
      }
    )
  },
}
