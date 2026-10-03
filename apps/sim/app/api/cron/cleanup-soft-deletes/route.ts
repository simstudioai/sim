import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { softDeletesCleanupContract } from '@/lib/api/contracts/cleanup'
import { parseRequest } from '@/lib/api/server/validation'
import { verifyCronAuth } from '@/lib/auth/internal'
import { dispatchBoundedCleanup, dispatchCleanupJobs } from '@/lib/billing/cleanup-dispatcher'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

export const dynamic = 'force-dynamic'

const logger = createLogger('SoftDeleteCleanupAPI')

/** Cron-secret maintenance protocol is global; workspace principal authorization does not apply. */
export const GET = withRouteHandler(async (request: NextRequest) => {
  try {
    const authError = verifyCronAuth(request, 'soft-delete cleanup')
    if (authError) return authError

    const parsed = await parseRequest(
      softDeletesCleanupContract,
      request,
      {},
      {
        rejectDuplicateQueryValues: true,
        rejectBlankQueryValues: true,
      }
    )
    if (!parsed.success) return parsed.response
    if (parsed.data.query) {
      const result = await dispatchBoundedCleanup('cleanup-soft-deletes', parsed.data.query)
      return NextResponse.json(result, { status: 202 })
    }

    const result = await dispatchCleanupJobs('cleanup-soft-deletes')

    logger.info('Soft-delete cleanup jobs dispatched', result)

    return NextResponse.json({ triggered: true, ...result })
  } catch (error) {
    logger.error('Failed to dispatch soft-delete cleanup jobs:', { error })
    return NextResponse.json({ error: 'Failed to dispatch soft-delete cleanup' }, { status: 500 })
  }
})
