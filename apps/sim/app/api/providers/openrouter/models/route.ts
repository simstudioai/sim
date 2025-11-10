import { type NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import { filterBlacklistedModels } from '@/providers/utils'

const logger = createLogger('OpenRouterModelsAPI')

interface OpenRouterModel {
  id: string
}

interface OpenRouterResponse {
  data: OpenRouterModel[]
}

export async function GET(_request: NextRequest) {
  try {
    const response = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { 'Content-Type': 'application/json' },
      next: { revalidate: 300 },
    })

    if (!response.ok) {
      logger.warn('Failed to fetch OpenRouter models', {
        status: response.status,
        statusText: response.statusText,
      })
      return NextResponse.json({ models: [] })
    }

    const data = (await response.json()) as OpenRouterResponse
    const allModels = Array.from(new Set(data.data?.map((model) => `openrouter/${model.id}`) ?? []))
    const models = filterBlacklistedModels(allModels)

    logger.info('Successfully fetched OpenRouter models', {
      count: models.length,
      filtered: allModels.length - models.length,
    })

    return NextResponse.json({ models })
  } catch (error) {
    logger.error('Error fetching OpenRouter models', {
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return NextResponse.json({ models: [] })
  }
}
