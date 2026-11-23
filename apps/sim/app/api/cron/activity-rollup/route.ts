import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/auth/internal'
import { enqueueActivityRollupPass } from '@/lib/billing/activity-rollup/enqueue'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('ActivityRollupCronRoute')

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * The activity rollup's cron: enqueues one maintenance pass per window while the
 * `activity-rollup-maintenance` flag is on, and returns once Trigger.dev accepts it.
 */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const authError = verifyCronAuth(request, 'Activity rollup')
  if (authError) return authError

  try {
    const result = await enqueueActivityRollupPass()
    return NextResponse.json({ success: true, ...result }, { status: result.triggered ? 202 : 200 })
  } catch (error) {
    logger.error('Activity rollup enqueue failed', { error: getErrorMessage(error) })
    return NextResponse.json({ success: false, error: 'Enqueue failed' }, { status: 500 })
  }
})
