import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/auth/internal'
import { dispatchCleanupJobs } from '@/lib/billing/cleanup-dispatcher'

export const dynamic = 'force-dynamic'

const logger = createLogger('TaskCleanupAPI')

export async function GET(request: NextRequest) {
  try {
    const authError = verifyCronAuth(request, 'task cleanup')
    if (authError) return authError

    const result = await dispatchCleanupJobs('cleanup-tasks')

    logger.info('Task cleanup jobs dispatched', result)

    return NextResponse.json({ triggered: true, ...result })
  } catch (error) {
    logger.error('Failed to dispatch task cleanup jobs:', { error })
    return NextResponse.json({ error: 'Failed to dispatch task cleanup' }, { status: 500 })
  }
}
