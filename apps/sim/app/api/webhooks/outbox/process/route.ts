import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/auth/internal'
import { billingOutboxHandlers } from '@/lib/billing/webhooks/outbox-handlers'
import { processOutboxEvents } from '@/lib/core/outbox/service'
import { generateRequestId } from '@/lib/core/utils/request'

const logger = createLogger('OutboxProcessorAPI')

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const handlers = {
  ...billingOutboxHandlers,
} as const

export async function GET(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const authError = verifyCronAuth(request, 'Outbox processor')
    if (authError) {
      return authError
    }

    const result = await processOutboxEvents(handlers, { batchSize: 20 })

    logger.info('Outbox processing completed', { requestId, ...result })

    return NextResponse.json({
      success: true,
      requestId,
      result,
    })
  } catch (error) {
    logger.error('Outbox processing failed', {
      requestId,
      error: error instanceof Error ? error.message : error,
    })
    return NextResponse.json(
      {
        success: false,
        requestId,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
