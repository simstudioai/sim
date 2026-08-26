import { createLogger } from '@sim/logger'
import { generateShortId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/auth/internal'
import { sweepBillingCycleCloses } from '@/lib/billing/cycle-close'
import { acquireLock, releaseLock } from '@/lib/core/config/redis'
import { runDetached } from '@/lib/core/utils/background'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('BillingCycleCloseCron')

const LOCK_KEY = 'billing-cycle-close-lock'
/** Lock TTL in seconds — generous enough to cover the full sweep. */
const LOCK_TTL_SECONDS = 15 * 60

export const dynamic = 'force-dynamic'

/**
 * Cron endpoint that closes elapsed billing periods (final overage collection,
 * `billedOverageThisPeriod` reset, last-period bookkeeping). Configured in
 * helm/sim/values.yaml under cronjobs.jobs.billingCycleClose.
 *
 * Acknowledges the cron call immediately and sweeps in the background; a Redis
 * lock prevents overlapping runs, and each subscription's close is durably
 * marked (`subscription.last_closed_period_start`), so replays are no-ops.
 */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const authError = verifyCronAuth(request, 'Billing cycle close')
  if (authError) {
    return authError
  }

  const lockValue = generateShortId()
  const locked = await acquireLock(LOCK_KEY, lockValue, LOCK_TTL_SECONDS, {
    reclaimOnFailure: true,
  })
  if (!locked) {
    return NextResponse.json(
      { success: true, message: 'Cycle-close sweep already in progress – skipped', status: 'skip' },
      { status: 202 }
    )
  }

  runDetached('billing-cycle-close', async () => {
    try {
      const summary = await sweepBillingCycleCloses()
      logger.info('Billing cycle-close sweep completed', { ...summary })
    } finally {
      await releaseLock(LOCK_KEY, lockValue).catch(() => {})
    }
  })

  return NextResponse.json(
    { success: true, message: 'Billing cycle-close sweep started', status: 'started' },
    { status: 202 }
  )
})
