import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { providerModelsResponseSchema } from '@/lib/api/contracts/providers'
import { env } from '@/lib/core/config/env'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { listOpenAICompatibleModels } from '@/providers/openai-compat/model-list'
import { filterBlacklistedModels, isProviderBlacklisted } from '@/providers/utils'

const logger = createLogger('LiteLLMModelsAPI')

export const GET = withRouteHandler(async (_request: NextRequest) => {
  if (isProviderBlacklisted('litellm')) {
    logger.info('LiteLLM provider is blacklisted, returning empty models')
    return NextResponse.json({ models: [] })
  }

  const baseUrl = env.LITELLM_BASE_URL?.trim()

  if (!baseUrl) {
    logger.info('LITELLM_BASE_URL not configured')
    return NextResponse.json({ models: [] })
  }

  try {
    logger.info('Fetching LiteLLM models', { baseUrl })

    const allModels = await listOpenAICompatibleModels({
      baseUrl,
      apiKey: env.LITELLM_API_KEY,
      prefix: 'litellm/',
      init: { next: { revalidate: 60 } },
    })

    if (!allModels) {
      logger.warn('LiteLLM service is not available')
      return NextResponse.json({ models: [] })
    }

    const models = filterBlacklistedModels(allModels)

    logger.info('Successfully fetched LiteLLM models', {
      count: models.length,
      filtered: allModels.length - models.length,
      models,
    })

    return NextResponse.json(providerModelsResponseSchema.parse({ models }))
  } catch (error) {
    logger.error('Failed to fetch LiteLLM models', {
      error: getErrorMessage(error, 'Unknown error'),
      baseUrl,
    })

    return NextResponse.json({ models: [] })
  }
})
