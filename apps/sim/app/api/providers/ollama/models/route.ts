import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { env } from '@/lib/core/config/env'
import type { ModelsObject } from '@/providers/ollama/types'

const logger = createLogger('OllamaModelsAPI')
const OLLAMA_HOST = env.OLLAMA_URL || 'http://localhost:11434'

/**
 * Get available Ollama models
 */
export async function GET(request: NextRequest) {
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

    const data = (await response.json()) as ModelsObject
    const models = data.models.map((model) => model.name)

    logger.info('Successfully fetched Ollama models', {
      count: models.length,
      models,
    })

    return NextResponse.json({ models })
  } catch (error) {
    logger.error('Failed to fetch Ollama models', {
      error: error instanceof Error ? error.message : 'Unknown error',
      host: OLLAMA_HOST,
    })

    return NextResponse.json({ models: [] })
  }
}
