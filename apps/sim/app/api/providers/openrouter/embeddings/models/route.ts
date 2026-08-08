import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import {
  openRouterEmbeddingModelsUpstreamResponseSchema,
  providerModelsResponseSchema,
} from '@/lib/api/contracts/providers'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { toOpenRouterEmbeddingModelId } from '@/lib/embeddings/openrouter-models'
import { filterBlacklistedModels, isProviderBlacklisted } from '@/providers/utils'

const logger = createLogger('OpenRouterEmbeddingModelsAPI')

export const GET = withRouteHandler(async (_request: NextRequest) => {
  if (isProviderBlacklisted('openrouter')) {
    logger.info('OpenRouter provider is blacklisted, returning empty embedding models')
    return NextResponse.json({ models: [] })
  }

  const response = await fetch('https://openrouter.ai/api/v1/embeddings/models', {
    headers: { 'Content-Type': 'application/json' },
    next: { revalidate: 300 },
  })
  if (!response.ok) {
    throw new Error(
      `Failed to fetch OpenRouter embedding models: ${response.status} ${response.statusText}`
    )
  }

  const data = openRouterEmbeddingModelsUpstreamResponseSchema.parse(await response.json())
  const uniqueModels = Array.from(
    new Set(data.data.map((model) => toOpenRouterEmbeddingModelId(model.id)))
  )
  const models = filterBlacklistedModels(uniqueModels)

  logger.info('Successfully fetched OpenRouter embedding models', {
    count: models.length,
    filtered: uniqueModels.length - models.length,
  })
  return NextResponse.json(providerModelsResponseSchema.parse({ models }))
})
