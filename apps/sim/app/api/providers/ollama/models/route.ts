import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import {
  ollamaUpstreamResponseSchema,
  providerModelsResponseSchema,
} from '@/lib/api/contracts/providers'
import { getOllamaUrl } from '@/lib/core/utils/urls'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { filterBlacklistedModels, isProviderBlacklisted } from '@/providers/utils'

const logger = createLogger('OllamaModelsAPI')
const OLLAMA_HOST = getOllamaUrl()

/**
 * Get available Ollama models
 */
export const GET = withRouteHandler(async (_request: NextRequest) => {
  if (isProviderBlacklisted('ollama')) {
    logger.info('Ollama provider is blacklisted, returning empty models')
    return NextResponse.json({ models: [] })
  }

  try {
    logger.info('Fetching Ollama models', {
      host: OLLAMA_HOST,
    })

    const response = await fetch(`${OLLAMA_HOST}/api/tags`, {
      headers: {
        'Content-Type': 'application/json',
      },
      next: { revalidate: 60 },
    })

    if (!response.ok) {
      logger.warn('Ollama service is not available', {
        status: response.status,
        statusText: response.statusText,
      })
      return NextResponse.json({ models: [] })
    }

    const data = ollamaUpstreamResponseSchema.parse(await response.json())
    const allModels = data.models.map((model) => model.name)
    const models = filterBlacklistedModels(allModels)

    logger.info('Successfully fetched Ollama models', {
      count: models.length,
      filtered: allModels.length - models.length,
      models,
    })

    return NextResponse.json(providerModelsResponseSchema.parse({ models }))
  } catch (error) {
    logger.error('Failed to fetch Ollama models', {
      error: getErrorMessage(error, 'Unknown error'),
      host: OLLAMA_HOST,
    })

    return NextResponse.json({ models: [] })
  }
})
