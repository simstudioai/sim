import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { logsCleanupContract } from '@/lib/api/contracts/cleanup'
import { parseRequest } from '@/lib/api/server/validation'
import { verifyCronAuth } from '@/lib/auth/internal'
import { dispatchBoundedCleanup, dispatchCleanupJobs } from '@/lib/billing/cleanup-dispatcher'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

export const dynamic = 'force-dynamic'

const logger = createLogger('LogsCleanupAPI')

/** Cron-secret maintenance protocol is global; workspace principal authorization does not apply. */
export const GET = withRouteHandler(async (request: NextRequest) => {
  try {
    const authError = verifyCronAuth(request, 'logs cleanup')
    if (authError) return authError

    const parsed = await parseRequest(
      logsCleanupContract,
      request,
      {},
      {
        rejectDuplicateQueryValues: true,
        rejectBlankQueryValues: true,
      }
    )
    if (!parsed.success) return parsed.response
    if (parsed.data.query) {
      const result = await dispatchBoundedCleanup('cleanup-logs', parsed.data.query)
      return NextResponse.json(result, { status: 202 })
    }

    const result = await dispatchCleanupJobs('cleanup-logs')

    logger.info('Log cleanup jobs dispatched', result)

    return NextResponse.json({ triggered: true, ...result })
  } catch (error) {
    logger.error('Failed to dispatch log cleanup jobs:', { error })
    return NextResponse.json({ error: 'Failed to dispatch log cleanup' }, { status: 500 })
  }
})
