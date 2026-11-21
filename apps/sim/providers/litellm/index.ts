import { createLogger } from '@sim/logger'
import { env } from '@/lib/core/config/env'
import type { StreamingExecution } from '@/executor/types'
import { getProviderDefaultModel, getProviderModels } from '@/providers/models'
import {
  discoverSelfHostedModels,
  executeSelfHostedChatRequest,
  type SelfHostedProviderConfig,
} from '@/providers/openai-compat/self-hosted'
import type { ProviderConfig, ProviderRequest, ProviderResponse } from '@/providers/types'

const LITELLM_CONFIG: SelfHostedProviderConfig = {
  providerId: 'litellm',
  providerName: 'LiteLLM',
  logger: createLogger('LiteLLMProvider'),
  getBaseUrl: () => env.LITELLM_BASE_URL,
  getApiKey: () => env.LITELLM_API_KEY,
  allowRequestEndpoint: false,
  maxTokensField: 'max_completion_tokens',
  forwardReasoningEffort: true,
  responseFormat: 'strict-deferred',
  reasoningFields: ['reasoning_content'],
  nameToolMessages: true,
}

export const litellmProvider: ProviderConfig = {
  id: 'litellm',
  name: 'LiteLLM',
  description: 'LiteLLM proxy with OpenAI-compatible API',
  version: '1.0.0',
  models: getProviderModels('litellm'),
  defaultModel: getProviderDefaultModel('litellm'),

  async initialize() {
    const models = await discoverSelfHostedModels(LITELLM_CONFIG)
    if (models) this.models = models
  },

  executeRequest: (request: ProviderRequest): Promise<ProviderResponse | StreamingExecution> =>
    executeSelfHostedChatRequest(request, LITELLM_CONFIG),
}
