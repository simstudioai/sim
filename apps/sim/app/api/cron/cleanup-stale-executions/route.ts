import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/auth/internal'
import { getJobQueue } from '@/lib/core/async-jobs'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

export const dynamic = 'force-dynamic'

const logger = createLogger('CleanupStaleExecutionsApi')
const STALE_EXECUTION_CLEANUP_INTERVAL_MS = 30 * 60 * 1000

export const GET = withRouteHandler(async (request: NextRequest) => {
  try {
    const authError = verifyCronAuth(request, 'Stale execution cleanup')
    if (authError) return authError

    const queue = await getJobQueue()
    const scheduleWindow = Math.floor(Date.now() / STALE_EXECUTION_CLEANUP_INTERVAL_MS)
    const jobId = await queue.enqueue(
      'cleanup-stale-executions',
      {},
      {
        maxAttempts: 1,
        jobId: `cleanup-stale-executions:${scheduleWindow}`,
        name: 'Stale execution cleanup',
        concurrencyKey: 'cleanup:stale-executions',
        concurrencyLimit: 1,
        runner: async () => {
          const { runCleanupStaleExecutions } = await import(
            '@/background/cleanup-stale-executions'
          )
          return runCleanupStaleExecutions()
        },
      }
    )

    logger.info('Stale execution cleanup dispatched', { jobId })
    return NextResponse.json({ triggered: true, jobId })
  } catch (error) {
    logger.error('Failed to dispatch stale execution cleanup', { error })
    return NextResponse.json(
      { error: 'Failed to dispatch stale execution cleanup' },
      { status: 500 }
    )
  }
})
