import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { providerModelsResponseSchema } from '@/lib/api/contracts/providers'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { filterBlacklistedModels, isProviderBlacklisted } from '@/providers/utils'

const logger = createLogger('OrcaRouterModelsAPI')

interface OrcaRouterModel {
  id: string
  supported_endpoint_types?: string[]
}

interface OrcaRouterResponse {
  data: OrcaRouterModel[]
}

/**
 * Enumerates the public OrcaRouter model catalog. OrcaRouter is an
 * OpenAI-compatible gateway that routes across many upstream providers, so its
 * `/v1/models` endpoint (like OpenRouter's) is public — no key needed to list.
 * Chat models are filtered to those exposing chat completions.
 */
export const GET = withRouteHandler(async (_request: NextRequest) => {
  if (isProviderBlacklisted('orcarouter')) {
    logger.info('OrcaRouter provider is blacklisted, returning empty models')
    return NextResponse.json({ models: [], modelInfo: {} })
  }

  try {
    const response = await fetch('https://api.orcarouter.ai/v1/models', {
      headers: { 'Content-Type': 'application/json' },
      next: { revalidate: 300 },
    })

    if (!response.ok) {
      logger.warn('Failed to fetch OrcaRouter models', {
        status: response.status,
        statusText: response.statusText,
      })
      return NextResponse.json({ models: [], modelInfo: {} })
    }

    const data: OrcaRouterResponse = await response.json()

    const allModels: string[] = []
    for (const model of data.data ?? []) {
      const endpoints = model.supported_endpoint_types ?? []
      // OrcaRouter exposes chat completions through the OpenAI-compatible
      // endpoint (`openai`); models without an endpoint list default to included.
      if (endpoints.length > 0 && !endpoints.includes('openai')) continue
      allModels.push(`orcarouter/${model.id}`)
    }

    const uniqueModels = Array.from(new Set(allModels))
    const models = filterBlacklistedModels(uniqueModels)

    logger.info('Successfully fetched OrcaRouter models', {
      count: models.length,
      filtered: uniqueModels.length - models.length,
    })

    return NextResponse.json(providerModelsResponseSchema.parse({ models, modelInfo: {} }))
  } catch (error) {
    logger.error('Error fetching OrcaRouter models', {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return NextResponse.json({ models: [], modelInfo: {} })
  }
})
