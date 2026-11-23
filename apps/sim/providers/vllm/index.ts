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

const VLLM_CONFIG: SelfHostedProviderConfig = {
  providerId: 'vllm',
  providerName: 'vLLM',
  logger: createLogger('VLLMProvider'),
  getBaseUrl: () => env.VLLM_BASE_URL,
  getApiKey: () => env.VLLM_API_KEY,
  allowRequestEndpoint: true,
  maxTokensField: 'max_tokens',
  forwardReasoningEffort: false,
  responseFormat: 'inline',
  reasoningFields: ['reasoning', 'reasoning_content'],
  nameToolMessages: false,
}

export const vllmProvider: ProviderConfig = {
  id: 'vllm',
  name: 'vLLM',
  description: 'Self-hosted vLLM with OpenAI-compatible API',
  version: '1.0.0',
  models: getProviderModels('vllm'),
  defaultModel: getProviderDefaultModel('vllm'),

  async initialize() {
    const models = await discoverSelfHostedModels(VLLM_CONFIG)
    if (models) this.models = models
  },

  executeRequest: (request: ProviderRequest): Promise<ProviderResponse | StreamingExecution> =>
    executeSelfHostedChatRequest(request, VLLM_CONFIG),
}
