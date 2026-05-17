import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import {
  providerModelsResponseSchema,
  vllmUpstreamResponseSchema,
} from '@/lib/api/contracts/providers'
import { env } from '@/lib/core/config/env'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { filterBlacklistedModels, isProviderBlacklisted } from '@/providers/utils'

const logger = createLogger('LiteLLMModelsAPI')

export const GET = withRouteHandler(async (_request: NextRequest) => {
  if (isProviderBlacklisted('litellm')) {
    logger.info('LiteLLM provider is blacklisted, returning empty models')
    return NextResponse.json({ models: [] })
  }

  const baseUrl = (env.LITELLM_BASE_URL || '').replace(/\/$/, '')

  if (!baseUrl) {
    logger.info('LITELLM_BASE_URL not configured')
    return NextResponse.json({ models: [] })
  }

  try {
    logger.info('Fetching LiteLLM models', { baseUrl })

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    if (env.LITELLM_API_KEY) {
      headers.Authorization = `Bearer ${env.LITELLM_API_KEY}`
    }

    const response = await fetch(`${baseUrl}/v1/models`, {
      headers,
      next: { revalidate: 60 },
    })

    if (!response.ok) {
      logger.warn('LiteLLM service is not available', {
        status: response.status,
        statusText: response.statusText,
      })
      return NextResponse.json({ models: [] })
    }

    const data = vllmUpstreamResponseSchema.parse(await response.json())
    const allModels = data.data.map((model) => `litellm/${model.id}`)
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
