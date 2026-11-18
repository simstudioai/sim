import { createLogger } from '@sim/logger'
import { generateShortId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/auth/internal'
import { isAwsMarketplaceEnabled } from '@/lib/billing/aws-marketplace/config'
import { reconcileAwsMarketplaceLicenses } from '@/lib/billing/aws-marketplace/reconcile'
import { acquireLock, releaseLock } from '@/lib/core/config/redis'
import { runDetached } from '@/lib/core/utils/background'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('AwsMarketplaceReconcileCron')

const LOCK_KEY = 'aws-marketplace-reconcile-lock'
/** Outlasts the reconcile's 6-minute run budget; the schedule runs every 15 minutes. */
const LOCK_TTL_SECONDS = 10 * 60

export const dynamic = 'force-dynamic'

/**
 * Applies AWS Marketplace agreement events from the SQS queue and re-verifies licenses no event
 * touched within a day. Acknowledges the cron call at once and works in the background; a Redis
 * lock keeps runs from overlapping, and every write is idempotent, so a replayed run is harmless.
 * A no-op on deployments without `AWS_MARKETPLACE_PRODUCTS`.
 */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const authError = verifyCronAuth(request, 'AWS Marketplace reconcile')
  if (authError) {
    return authError
  }

  if (!isAwsMarketplaceEnabled()) {
    return NextResponse.json({
      success: true,
      message: 'AWS Marketplace is not configured – skipped',
      status: 'skip',
    })
  }

  const lockValue = generateShortId()
  const locked = await acquireLock(LOCK_KEY, lockValue, LOCK_TTL_SECONDS, {
    reclaimOnFailure: true,
  })
  if (!locked) {
    return NextResponse.json(
      {
        success: true,
        message: 'AWS Marketplace reconcile already in progress – skipped',
        status: 'skip',
      },
      { status: 202 }
    )
  }

  runDetached('aws-marketplace-reconcile', async () => {
    try {
      const summary = await reconcileAwsMarketplaceLicenses()
      logger.info('AWS Marketplace reconcile completed', { ...summary })
    } finally {
      await releaseLock(LOCK_KEY, lockValue).catch(() => {})
    }
  })

  return NextResponse.json(
    { success: true, message: 'AWS Marketplace reconcile started', status: 'started' },
    { status: 202 }
  )
})
