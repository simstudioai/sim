import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { providerModelsResponseSchema } from '@/lib/api/contracts/providers'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { fetchOpenRouterEmbeddingModelCatalog } from '@/lib/embeddings/openrouter-model-catalog.server'
import { filterBlacklistedModels, isProviderBlacklisted } from '@/providers/utils'

const logger = createLogger('OpenRouterEmbeddingModelsAPI')

export const GET = withRouteHandler(async (_request: NextRequest) => {
  if (isProviderBlacklisted('openrouter')) {
    logger.info('OpenRouter provider is blacklisted, returning empty embedding models')
    return NextResponse.json({ models: [] })
  }

  const uniqueModels = (await fetchOpenRouterEmbeddingModelCatalog()).map((model) => model.id)
  const models = filterBlacklistedModels(uniqueModels)

  logger.info('Successfully fetched OpenRouter embedding models', {
    count: models.length,
    filtered: uniqueModels.length - models.length,
  })
  return NextResponse.json(providerModelsResponseSchema.parse({ models }))
})
