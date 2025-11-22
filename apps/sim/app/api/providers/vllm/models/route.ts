import { type NextRequest, NextResponse } from 'next/server'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('VLLMModelsAPI')

/**
 * Get available vLLM models
 */
export async function GET(request: NextRequest) {
  const baseUrl = (env.VLLM_BASE_URL || '').replace(/\/$/, '')

  if (!baseUrl) {
    logger.info('VLLM_BASE_URL not configured')
    return NextResponse.json({ models: [] })
  }

  try {
    logger.info('Fetching vLLM models', {
      baseUrl,
    })

    const response = await fetch(`${baseUrl}/v1/models`, {
      headers: {
        'Content-Type': 'application/json',
      },
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
    const models = data.data.map((model) => `vllm/${model.id}`)

    logger.info('Successfully fetched vLLM models', {
      count: models.length,
      models,
    })

    return NextResponse.json({ models })
  } catch (error) {
    logger.error('Failed to fetch vLLM models', {
      error: error instanceof Error ? error.message : 'Unknown error',
      baseUrl,
    })

    // Return empty array instead of error to avoid breaking the UI
    return NextResponse.json({ models: [] })
  }
}
