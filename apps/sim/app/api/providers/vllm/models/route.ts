import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { providerModelsResponseSchema } from '@/lib/api/contracts/providers'
import { env } from '@/lib/core/config/env'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { listOpenAICompatibleModels } from '@/providers/openai-compat/model-list'
import { filterBlacklistedModels, isProviderBlacklisted } from '@/providers/utils'

const logger = createLogger('VLLMModelsAPI')

/**
 * Get available vLLM models
 */
export const GET = withRouteHandler(async (_request: NextRequest) => {
  if (isProviderBlacklisted('vllm')) {
    logger.info('vLLM provider is blacklisted, returning empty models')
    return NextResponse.json({ models: [] })
  }

  const baseUrl = env.VLLM_BASE_URL?.trim()

  if (!baseUrl) {
    logger.info('VLLM_BASE_URL not configured')
    return NextResponse.json({ models: [] })
  }

  try {
    logger.info('Fetching vLLM models', { baseUrl })

    const allModels = await listOpenAICompatibleModels({
      baseUrl,
      apiKey: env.VLLM_API_KEY,
      prefix: 'vllm/',
      init: { next: { revalidate: 60 } },
    })

    if (!allModels) return NextResponse.json({ models: [] })

    const models = filterBlacklistedModels(allModels)

    logger.info('Successfully fetched vLLM models', {
      count: models.length,
      filtered: allModels.length - models.length,
      models,
    })

    return NextResponse.json(providerModelsResponseSchema.parse({ models }))
  } catch (error) {
    logger.error('Failed to fetch vLLM models', {
      error: getErrorMessage(error, 'Unknown error'),
      baseUrl,
    })

    return NextResponse.json({ models: [] })
  }
})
