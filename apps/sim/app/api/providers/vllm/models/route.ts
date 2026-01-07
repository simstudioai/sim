import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { env } from '@/lib/core/config/env'
import { filterBlacklistedModels, isProviderBlacklisted } from '@/providers/utils'

const logger = createLogger('VLLMModelsAPI')

/**
 * Get available vLLM models
 */
export async function GET(_request: NextRequest) {
  if (isProviderBlacklisted('vllm')) {
    logger.info('vLLM provider is blacklisted, returning empty models')
    return NextResponse.json({ models: [] })
  }

  const baseUrl = (env.VLLM_BASE_URL || '').replace(/\/$/, '')

  if (!baseUrl) {
    logger.info('VLLM_BASE_URL not configured')
    return NextResponse.json({ models: [] })
  }

  try {
    logger.info('Fetching vLLM models', {
      baseUrl,
    })

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    if (env.VLLM_API_KEY) {
      headers.Authorization = `Bearer ${env.VLLM_API_KEY}`
    }

    const response = await fetch(`${baseUrl}/v1/models`, {
      headers,
      next: { revalidate: 60 },
    })

    if (!response.ok) {
      logger.warn('vLLM service is not available', {
        status: response.status,
        statusText: response.statusText,
      })
      return NextResponse.json({ models: [] })
    }

    const data = (await response.json()) as { data: Array<{ id: string }> }
    const allModels = data.data.map((model) => `vllm/${model.id}`)
    const models = filterBlacklistedModels(allModels)

    logger.info('Successfully fetched vLLM models', {
      count: models.length,
      filtered: allModels.length - models.length,
      models,
    })

    return NextResponse.json({ models })
  } catch (error) {
    logger.error('Failed to fetch vLLM models', {
      error: error instanceof Error ? error.message : 'Unknown error',
      baseUrl,
    })

    return NextResponse.json({ models: [] })
  }
}
