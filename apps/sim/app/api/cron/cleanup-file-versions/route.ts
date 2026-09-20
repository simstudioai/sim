import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/auth/internal'
import { dispatchCleanupJobs } from '@/lib/billing/cleanup-dispatcher'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

export const dynamic = 'force-dynamic'

const logger = createLogger('FileVersionCleanupAPI')

/** GET /api/cron/cleanup-file-versions — dispatch retention for superseded workspace file versions. */
export const GET = withRouteHandler(async (request: NextRequest) => {
  try {
    const authError = verifyCronAuth(request, 'file version cleanup')
    if (authError) return authError

    const result = await dispatchCleanupJobs('cleanup-file-versions')

    logger.info('File version cleanup jobs dispatched', result)

    return NextResponse.json({ triggered: true, ...result })
  } catch (error) {
    logger.error('Failed to dispatch file version cleanup jobs:', { error })
    return NextResponse.json({ error: 'Failed to dispatch file version cleanup' }, { status: 500 })
  }
})
