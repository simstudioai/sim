import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/auth/internal'
import { dispatchCleanupJobs } from '@/lib/billing/cleanup-dispatcher'

export const dynamic = 'force-dynamic'

const logger = createLogger('SoftDeleteCleanupAPI')

export async function GET(request: NextRequest) {
  try {
    const authError = verifyCronAuth(request, 'soft-delete cleanup')
    if (authError) return authError

    const result = await dispatchCleanupJobs('cleanup-soft-deletes')

    logger.info('Soft-delete cleanup jobs dispatched', result)

    return NextResponse.json({ triggered: true, ...result })
  } catch (error) {
    logger.error('Failed to dispatch soft-delete cleanup jobs:', { error })
    return NextResponse.json({ error: 'Failed to dispatch soft-delete cleanup' }, { status: 500 })
  }
}
