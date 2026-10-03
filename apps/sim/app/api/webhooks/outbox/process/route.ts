import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/auth/internal'
import { enqueueOutboxProcessor } from '@/lib/core/outbox/enqueue'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('OutboxProcessorAPI')

export const dynamic = 'force-dynamic'
/** Self-hosted deployments without Trigger.dev retain the synchronous processing window. */
export const maxDuration = 800

/** The cron secret authorizes this lifecycle endpoint; hosted processing runs outside the HTTP request. */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const authError = verifyCronAuth(request, 'Outbox processor')
  if (authError) return authError

  const requestId = generateRequestId()
  try {
    const accepted = await enqueueOutboxProcessor()
    if (accepted.backend === 'trigger-dev') {
      logger.info('Outbox processor accepted', { jobId: accepted.jobId })
      return NextResponse.json(
        { success: true, requestId, triggered: true, ...accepted },
        { status: 202 }
      )
    }
    return NextResponse.json({ success: true, requestId, ...accepted.output })
  } catch (error) {
    logger.error('Outbox processing failed', { error: toError(error).message })
    return NextResponse.json(
      { success: false, requestId, error: toError(error).message },
      { status: 500 }
    )
  }
})
