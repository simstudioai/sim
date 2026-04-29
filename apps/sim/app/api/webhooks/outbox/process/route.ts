import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { noInputSchema } from '@/lib/api/contracts/primitives'
import { validateSchema } from '@/lib/api/server'
import { verifyCronAuth } from '@/lib/auth/internal'
import { billingOutboxHandlers } from '@/lib/billing/webhooks/outbox-handlers'
import { processOutboxEvents } from '@/lib/core/outbox/service'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('OutboxProcessorAPI')

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const handlers = {
  ...billingOutboxHandlers,
} as const

export const GET = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const validation = validateSchema(noInputSchema, {})
    if (!validation.success) return validation.response

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
    logger.error('Outbox processing failed', { requestId, error: toError(error).message })
    return NextResponse.json(
      { success: false, requestId, error: toError(error).message },
      { status: 500 }
    )
  }
})
