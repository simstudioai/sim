import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('CopilotTrainingAPI')

const WorkflowStateSchema = z.record(z.unknown())

const OperationSchema = z.object({
  operation_type: z.string(),
  block_id: z.string(),
  params: z.record(z.unknown()).optional(),
})

const TrainingDataSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  prompt: z.string().min(1, 'Prompt is required'),
  input: WorkflowStateSchema,
  output: WorkflowStateSchema,
  operations: z.array(OperationSchema),
})

export async function POST(request: NextRequest) {
  try {
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
      operationsCount: operations.length,
    })

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
