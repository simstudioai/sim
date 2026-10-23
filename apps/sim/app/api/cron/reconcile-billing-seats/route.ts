import { createLogger } from '@sim/logger'
import { toStringOrNull } from '@sim/utils/coerce'
import { toError } from '@sim/utils/errors'
import { toRecord } from '@sim/utils/object'
import { type NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/auth/internal'
import { reconcileTeamSeatDrift } from '@/lib/billing/organizations/seat-drift'
import { OUTBOX_EVENT_TYPES } from '@/lib/billing/webhooks/outbox-events'
import { findDeadLetteredEvents } from '@/lib/core/outbox/service'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('BillingSeatReconcileCron')

export const dynamic = 'force-dynamic'

const BILLING_SYNC_EVENT_TYPES = [
  OUTBOX_EVENT_TYPES.STRIPE_SYNC_SUBSCRIPTION_SEATS,
  OUTBOX_EVENT_TYPES.STRIPE_SYNC_CANCEL_AT_PERIOD_END,
]

/**
 * Dead letters newer than two hourly runs log at ERROR, so one missed run cannot hide one; older
 * ones repeat at WARN until requeued or resolved through the admin outbox API.
 */
const NEW_DEAD_LETTER_WINDOW_MS = 2 * 60 * 60 * 1000

function describeDeadLetter(event: Awaited<ReturnType<typeof findDeadLetteredEvents>>[number]) {
  return {
    id: event.id,
    eventType: event.eventType,
    subscriptionId: toStringOrNull(toRecord(event.payload).subscriptionId),
    deadLetteredAt: event.processedAt?.toISOString() ?? null,
    lastError: event.lastError,
  }
}

/**
 * Periodic billing-seat reconciliation. Self-heals Team organizations whose
 * stored seat count drifted from their member count, and reports any
 * dead-lettered Stripe seat/cancel sync events so a member who has access but
 * whose seat charge never synced is surfaced for manual remediation rather than
 * silently under-billed.
 *
 * Scheduled in helm/sim/values.yaml under cronjobs.jobs.reconcileBillingSeats.
 */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  const authError = verifyCronAuth(request, 'Billing seat reconciliation')
  if (authError) {
    return authError
  }

  try {
    const drift = await reconcileTeamSeatDrift()

    const deadLettered = await findDeadLetteredEvents(BILLING_SYNC_EVENT_TYPES)
    const newSince = Date.now() - NEW_DEAD_LETTER_WINDOW_MS
    const isNew = (event: (typeof deadLettered)[number]) =>
      event.processedAt !== null && event.processedAt.getTime() >= newSince
    const newlyDeadLettered = deadLettered.filter(isNew)
    const previouslyReported = deadLettered.filter((event) => !isNew(event))
    if (newlyDeadLettered.length > 0) {
      logger.error(
        'Dead-lettered billing sync events require manual remediation — a billing state change (seat charge or cancellation) never reached Stripe',
        {
          requestId,
          count: newlyDeadLettered.length,
          events: newlyDeadLettered.map(describeDeadLetter),
        }
      )
    }
    if (previouslyReported.length > 0) {
      logger.warn(
        'Previously reported billing sync dead letters are still unresolved — requeue or resolve them through the admin outbox API',
        {
          requestId,
          count: previouslyReported.length,
          events: previouslyReported.map(describeDeadLetter),
        }
      )
    }

    logger.info('Billing seat reconciliation completed', {
      requestId,
      ...drift,
      deadLetteredBillingSyncs: deadLettered.length,
    })

    return NextResponse.json({
      success: true,
      requestId,
      drift,
      deadLetteredBillingSyncs: deadLettered.length,
    })
  } catch (error) {
    logger.error('Billing seat reconciliation failed', {
      requestId,
      error: toError(error).message,
    })
    return NextResponse.json(
      { success: false, requestId, error: toError(error).message },
      { status: 500 }
    )
  }
})
