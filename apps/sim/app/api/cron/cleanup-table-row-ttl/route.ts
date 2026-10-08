import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/auth/internal'
import { getJobQueue } from '@/lib/core/async-jobs'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

export const dynamic = 'force-dynamic'

const logger = createLogger('CleanupTableRowTtlApi')
const TTL_CLEANUP_INTERVAL_MS = 15 * 60 * 1000

export const GET = withRouteHandler(async (request: NextRequest) => {
  try {
    const authError = verifyCronAuth(request, 'table row TTL cleanup')
    if (authError) return authError

    const queue = await getJobQueue()
    const scheduleWindow = Math.floor(Date.now() / TTL_CLEANUP_INTERVAL_MS)
    const jobId = await queue.enqueue(
      'cleanup-table-row-ttl',
      {},
      {
        maxAttempts: 1,
        jobId: `cleanup-table-row-ttl:${scheduleWindow}`,
        name: 'Table row TTL cleanup',
        concurrencyKey: 'cleanup:table-row-ttl',
        concurrencyLimit: 1,
        runner: async (_payload, signal) => {
          const { runCleanupTableRowTtl } = await import('@/background/cleanup-table-row-ttl')
          return runCleanupTableRowTtl(signal)
        },
      }
    )

    logger.info('Table row TTL cleanup dispatched', { jobId })
    return NextResponse.json({ triggered: true, jobId })
  } catch (error) {
    logger.error('Failed to dispatch table row TTL cleanup', { error })
    return NextResponse.json({ error: 'Failed to dispatch table row TTL cleanup' }, { status: 500 })
  }
})
