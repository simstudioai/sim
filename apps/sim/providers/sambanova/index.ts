import { createLogger } from '@/lib/logs/console/logger'
import { getProviderDefaultModel, getProviderModels } from '@/providers/models'
import type { ProviderConfig, ProviderRequest, ProviderResponse } from '@/providers/types'

const logger = createLogger('SambaNovaProvider')

/**
 * SambaNova provider configuration
 * Note: This is a placeholder provider for model listing.
 * Actual API implementation should be added when SambaNova API is integrated.
 */
export const sambanovaProvider: ProviderConfig = {
  id: 'sambanova',
  name: 'SambaNova',
  description: "SambaNova's AI models",
  version: '1.0.0',
  models: getProviderModels('sambanova'),
  defaultModel: getProviderDefaultModel('sambanova'),

  executeRequest: async (request: ProviderRequest): Promise<ProviderResponse> => {
    logger.error('SambaNova provider execution not yet implemented', {
      model: request.model,
    })
    throw new Error(
      'SambaNova provider is not yet implemented. Models are available for selection but execution is not supported.'
    )
  },
}
