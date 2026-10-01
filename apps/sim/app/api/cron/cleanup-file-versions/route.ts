import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/auth/internal'
import { getJobQueue } from '@/lib/core/async-jobs'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { CLEANUP_DISPATCH_MAX_ATTEMPTS } from '@/background/cleanup-dispatch'

export const dynamic = 'force-dynamic'

const logger = createLogger('FileVersionCleanupAPI')
const FILE_VERSION_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000

/** GET /api/cron/cleanup-file-versions — dispatch retention for superseded workspace file versions. */
export const GET = withRouteHandler(async (request: NextRequest) => {
  try {
    const authError = verifyCronAuth(request, 'file version cleanup')
    if (authError) return authError

    const queue = await getJobQueue()
    const scheduleWindow = Math.floor(Date.now() / FILE_VERSION_CLEANUP_INTERVAL_MS)
    const jobId = await queue.enqueue(
      'cleanup-dispatch',
      { jobType: 'cleanup-file-versions' },
      {
        maxAttempts: CLEANUP_DISPATCH_MAX_ATTEMPTS,
        jobId: `cleanup-dispatch:cleanup-file-versions:${scheduleWindow}`,
        name: 'File version cleanup dispatch',
        concurrencyKey: 'cleanup-dispatch:cleanup-file-versions',
        concurrencyLimit: 1,
        runner: async () => {
          const { dispatchCleanupJobs } = await import('@/lib/billing/cleanup-dispatcher')
          return dispatchCleanupJobs('cleanup-file-versions')
        },
      }
    )

    logger.info('File version cleanup dispatch enqueued', { jobId })
    return NextResponse.json({ triggered: true, jobId })
  } catch (error) {
    logger.error('Failed to dispatch file version cleanup jobs:', { error })
    return NextResponse.json({ error: 'Failed to dispatch file version cleanup' }, { status: 500 })
  }
})
