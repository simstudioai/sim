import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/auth/internal'
import { dispatchCleanupJobs } from '@/lib/billing/cleanup-dispatcher'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

export const dynamic = 'force-dynamic'

const logger = createLogger('LogsCleanupAPI')

export const GET = withRouteHandler(async (request: NextRequest) => {
  try {
    const authError = verifyCronAuth(request, 'logs cleanup')
    if (authError) return authError

    const result = await dispatchCleanupJobs('cleanup-logs')

    logger.info('Log cleanup jobs dispatched', result)

    return NextResponse.json({ triggered: true, ...result })
  } catch (error) {
    logger.error('Failed to dispatch log cleanup jobs:', { error })
    return NextResponse.json({ error: 'Failed to dispatch log cleanup' }, { status: 500 })
  }
})
