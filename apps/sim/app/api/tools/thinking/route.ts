import { type NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import type { ThinkingToolParams, ThinkingToolResponse } from '@/tools/thinking/types'

const logger = createLogger('ThinkingToolAPI')

export const dynamic = 'force-dynamic'

/**
 * POST - Process a thinking tool request
 * Simply acknowledges the thought by returning it in the output
 */
export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    const body: ThinkingToolParams = await request.json()

    logger.info(`[${requestId}] Processing thinking tool request`)

    // Validate the required parameter
    if (!body.thought || typeof body.thought !== 'string') {
      logger.warn(`[${requestId}] Missing or invalid 'thought' parameter`)
      return NextResponse.json(
        {
          success: false,
          error: 'The thought parameter is required and must be a string',
        },
        { status: 400 }
      )
    }

    // Simply acknowledge the thought by returning it in the output
    const response: ThinkingToolResponse = {
      success: true,
      output: {
        acknowledgedThought: body.thought,
      },
    }

    logger.info(`[${requestId}] Thinking tool processed successfully`)
    return NextResponse.json(response)
  } catch (error) {
    logger.error(`[${requestId}] Error processing thinking tool:`, error)
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to process thinking tool request',
      },
      { status: 500 }
    )
  }
}
