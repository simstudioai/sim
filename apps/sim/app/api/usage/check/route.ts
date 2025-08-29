import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { checkServerSideUsageLimits } from '@/lib/billing'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('UsageCheckAPI')

export async function GET(_request: NextRequest) {
  const session = await getSession()
  try {
    const userId = session?.user?.id
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const result = await checkServerSideUsageLimits(userId)
    // Normalize to client usage shape
    return NextResponse.json({
      success: true,
      data: {
        percentUsed:
          result.limit > 0
            ? Math.min(Math.floor((result.currentUsage / result.limit) * 100), 100)
            : 0,
        isWarning:
          result.limit > 0
            ? (result.currentUsage / result.limit) * 100 >= 80 &&
              (result.currentUsage / result.limit) * 100 < 100
            : false,
        isExceeded: result.isExceeded,
        currentUsage: result.currentUsage,
        limit: result.limit,
        message: result.message,
      },
    })
  } catch (error) {
    logger.error('Failed usage check', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
