import { type NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('OpenRouterModelsAPI')

export const dynamic = 'force-dynamic'

export async function GET(_request: NextRequest) {
  try {
    const response = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
    })

    if (!response.ok) {
      logger.warn('Failed to fetch OpenRouter models', {
        status: response.status,
        statusText: response.statusText,
      })
      return NextResponse.json({ models: [] })
    }

    const data = await response.json()
    const models = Array.isArray(data?.data)
      ? Array.from(
          new Set(
            data.data
              .map((m: any) => m?.id)
              .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
              .map((id: string) => `openrouter/${id}`)
          )
        )
      : []

    logger.info('Successfully fetched OpenRouter models', {
      count: models.length,
    })

    return NextResponse.json({ models })
  } catch (error) {
    logger.error('Error fetching OpenRouter models', {
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return NextResponse.json({ models: [] })
  }
}
