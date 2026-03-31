import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { env } from '@/lib/core/config/env'
import { filterBlacklistedModels, isProviderBlacklisted } from '@/providers/utils'

const logger = createLogger('FireworksModelsAPI')

interface FireworksModel {
  id: string
  object?: string
  created?: number
  owned_by?: string
}

interface FireworksModelsResponse {
  data: FireworksModel[]
  object?: string
}

export async function GET(_request: NextRequest) {
  if (isProviderBlacklisted('fireworks')) {
    logger.info('Fireworks provider is blacklisted, returning empty models')
    return NextResponse.json({ models: [] })
  }

  const apiKey = env.FIREWORKS_API_KEY
  if (!apiKey) {
    logger.info('No FIREWORKS_API_KEY configured, returning empty models')
    return NextResponse.json({ models: [] })
  }

  try {
    const response = await fetch('https://api.fireworks.ai/inference/v1/models', {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      next: { revalidate: 300 },
    })

    if (!response.ok) {
      logger.warn('Failed to fetch Fireworks models', {
        status: response.status,
        statusText: response.statusText,
      })
      return NextResponse.json({ models: [] })
    }

    const data = (await response.json()) as FireworksModelsResponse

    const allModels: string[] = []
    for (const model of data.data ?? []) {
      allModels.push(`fireworks/${model.id}`)
    }

    const uniqueModels = Array.from(new Set(allModels))
    const models = filterBlacklistedModels(uniqueModels)

    logger.info('Successfully fetched Fireworks models', {
      count: models.length,
      filtered: uniqueModels.length - models.length,
    })

    return NextResponse.json({ models })
  } catch (error) {
    logger.error('Error fetching Fireworks models', {
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return NextResponse.json({ models: [] })
  }
}
