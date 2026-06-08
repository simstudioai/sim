import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/auth/internal'
import { reconcileTeamSeatDrift } from '@/lib/billing/organizations/seat-drift'
import { OUTBOX_EVENT_TYPES } from '@/lib/billing/webhooks/outbox-handlers'
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
    if (deadLettered.length > 0) {
      logger.error(
        'Dead-lettered billing sync events require manual remediation — a billing state change (seat charge or cancellation) never reached Stripe',
        {
          requestId,
          count: deadLettered.length,
          events: deadLettered.map((event) => ({
            id: event.id,
            eventType: event.eventType,
            subscriptionId: (event.payload as { subscriptionId?: string } | null)?.subscriptionId,
            lastError: event.lastError,
          })),
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
