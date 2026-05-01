import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { thinkingToolContract } from '@/lib/api/contracts/tools/internal/thinking'
import { parseRequest } from '@/lib/api/server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import type { ThinkingToolResponse } from '@/tools/thinking/types'

const logger = createLogger('ThinkingToolAPI')

export const dynamic = 'force-dynamic'

/**
 * POST - Process a thinking tool request
 * Simply acknowledges the thought by returning it in the output
 */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const parsed = await parseRequest(thinkingToolContract, request, {})
    if (!parsed.success) return parsed.response
    const { body } = parsed.data

    logger.info(`[${requestId}] Processing thinking tool request`)

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
})
