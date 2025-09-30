import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('CopilotTrainingAPI')

// Schema for the request body
const TrainingDataSchema = z.object({
  title: z.string().min(1),
  prompt: z.string().min(1),
  input: z.any(), // Workflow state (start)
  output: z.any(), // Workflow state (end)
  operations: z.any(),
})

export async function POST(request: NextRequest) {
  try {
    // Check for required environment variables
    const baseUrl = env.AGENT_INDEXER_URL
    if (!baseUrl) {
      logger.error('Missing AGENT_INDEXER_URL environment variable')
      return NextResponse.json({ error: 'Agent indexer not configured' }, { status: 500 })
    }

    const apiKey = env.AGENT_INDEXER_API_KEY
    if (!apiKey) {
      logger.error('Missing AGENT_INDEXER_API_KEY environment variable')
      return NextResponse.json(
        { error: 'Agent indexer authentication not configured' },
        { status: 500 }
      )
    }

    // Parse and validate request body
    const body = await request.json()
    const validationResult = TrainingDataSchema.safeParse(body)

    if (!validationResult.success) {
      logger.warn('Invalid training data format', { errors: validationResult.error.errors })
      return NextResponse.json(
        {
          error: 'Invalid training data format',
          details: validationResult.error.errors,
        },
        { status: 400 }
      )
    }

    const { title, prompt, input, output, operations } = validationResult.data

    logger.info('Sending training data to agent indexer', {
      title,
      operationsCount: Array.isArray(operations) ? operations.length : 0,
    })

    // Forward to agent indexer
    const upstreamUrl = `${baseUrl}/operations/add`
    const upstreamResponse = await fetch(upstreamUrl, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        title,
        prompt,
        input,
        output,
        operations: { operations },
      }),
    })

    const responseData = await upstreamResponse.json()

    if (!upstreamResponse.ok) {
      logger.error('Agent indexer rejected the data', {
        status: upstreamResponse.status,
        response: responseData,
      })
      return NextResponse.json(responseData, { status: upstreamResponse.status })
    }

    logger.info('Successfully sent training data to agent indexer', {
      title,
      response: responseData,
    })

    return NextResponse.json(responseData)
  } catch (error) {
    logger.error('Failed to send training data to agent indexer', { error })
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to send training data',
      },
      { status: 502 }
    )
  }
}
