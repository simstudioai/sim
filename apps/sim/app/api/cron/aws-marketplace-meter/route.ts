import { createLogger } from '@sim/logger'
import { generateShortId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/auth/internal'
import { isAwsMarketplaceEnabled } from '@/lib/billing/aws-marketplace/config'
import { meterAwsMarketplaceUsage } from '@/lib/billing/aws-marketplace/metering'
import { acquireLock, releaseLock } from '@/lib/core/config/redis'
import { runDetached } from '@/lib/core/utils/background'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('AwsMarketplaceMeterCron')

const LOCK_KEY = 'aws-marketplace-meter-lock'
/** Outlasts a run comfortably; the schedule runs every 15 minutes. */
const LOCK_TTL_SECONDS = 10 * 60

export const dynamic = 'force-dynamic'

/**
 * Records newly closed hours of usage owed through AWS Marketplace and sends AWS what it has not
 * accepted yet. Acknowledges the cron call at once and works in the background; a Redis lock keeps
 * runs from overlapping, and the ledger makes a replayed run harmless. A no-op on deployments
 * where no configured listing bills usage.
 */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const authError = verifyCronAuth(request, 'AWS Marketplace metering')
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
        message: 'AWS Marketplace metering already in progress – skipped',
        status: 'skip',
      },
      { status: 202 }
    )
  }

  runDetached('aws-marketplace-meter', async () => {
    try {
      const summary = await meterAwsMarketplaceUsage()
      if (summary) logger.info('AWS Marketplace metering completed', { ...summary })
    } finally {
      await releaseLock(LOCK_KEY, lockValue).catch(() => {})
    }
  })

  return NextResponse.json(
    { success: true, message: 'AWS Marketplace metering started', status: 'started' },
    { status: 202 }
  )
})
