import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('CopilotTrainingExamplesAPI')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const TrainingExampleSchema = z.object({
  json: z.string().min(1, 'JSON string is required'),
  title: z.string().min(1, 'Title is required'),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
})

export async function POST(request: NextRequest) {
  const baseUrl = env.AGENT_INDEXER_URL
  if (!baseUrl) {
    logger.error('Missing AGENT_INDEXER_URL environment variable')
    return NextResponse.json({ error: 'Missing AGENT_INDEXER_URL env' }, { status: 500 })
  }

  const apiKey = env.AGENT_INDEXER_API_KEY
  if (!apiKey) {
    logger.error('Missing AGENT_INDEXER_API_KEY environment variable')
    return NextResponse.json({ error: 'Missing AGENT_INDEXER_API_KEY env' }, { status: 500 })
  }

  try {
    const body = await request.json()

    const validationResult = TrainingExampleSchema.safeParse(body)

    if (!validationResult.success) {
      logger.warn('Invalid training example format', { errors: validationResult.error.errors })
      return NextResponse.json(
        {
          error: 'Invalid training example format',
          details: validationResult.error.errors,
        },
        { status: 400 }
      )
    }

    const validatedData = validationResult.data

    logger.info('Sending workflow example to agent indexer', {
      hasJsonField: typeof validatedData.json === 'string',
      title: validatedData.title,
    })

    const upstream = await fetch(`${baseUrl}/examples/add`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify(validatedData),
    })

    if (!upstream.ok) {
      const errorText = await upstream.text()
      logger.error('Agent indexer rejected the example', {
        status: upstream.status,
        error: errorText,
      })
      return NextResponse.json({ error: errorText }, { status: upstream.status })
    }

    const data = await upstream.json()
    logger.info('Successfully sent workflow example to agent indexer')

    return NextResponse.json(data, {
      headers: { 'content-type': 'application/json' },
    })
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Failed to add example'
    logger.error('Failed to send workflow example', { error: err })
    return NextResponse.json({ error: errorMessage }, { status: 502 })
  }
}
