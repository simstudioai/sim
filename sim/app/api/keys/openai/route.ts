import { unstable_noStore as noStore } from 'next/cache'
import { NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console-logger'
import { getRotatingApiKey } from '@/lib/utils'

const logger = createLogger('OpenAIKeyAPI')

export const dynamic = 'force-dynamic'

/**
 * Get a rotating OpenAI API key for the specified model
 * This endpoint is designed to be used by client-side code
 * to get access to server-side environment variables
 */
export async function POST(request: NextRequest) {
  noStore()

  try {
    const { model } = await request.json()

    if (!model) {
      return NextResponse.json({ error: 'Model parameter is required' }, { status: 400 })
    }

    // Only provide API key for gpt-4o models
    if (model !== 'gpt-4o') {
      return NextResponse.json(
        { error: 'API key rotation is only available for gpt-4o models' },
        { status: 400 }
      )
    }

    // Check if we're on the hosted version - this is a server-side check
    const isHostedVersion = process.env.NEXT_PUBLIC_APP_URL === 'https://www.simstudio.ai'
    if (!isHostedVersion) {
      return NextResponse.json(
        { error: 'API key rotation is only available on the hosted version' },
        { status: 403 }
      )
    }

    try {
      // Use the shared utility function to get a rotating key
      const apiKey = getRotatingApiKey('openai')
      logger.info(`Provided rotating API key for model: ${model}`)
      return NextResponse.json({ apiKey })
    } catch (error) {
      logger.error('Failed to get rotating API key:', error)
      return NextResponse.json({ error: 'No API keys configured for rotation' }, { status: 500 })
    }
  } catch (error) {
    logger.error('Error providing API key:', error)
    return NextResponse.json(
      { error: 'Failed to provide API key', message: (error as Error).message },
      { status: 500 }
    )
  }
}
