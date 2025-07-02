import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getUserUsageLimitInfo, updateUserUsageLimit } from '@/lib/billing'
import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('UsageLimitAPI')

export async function GET(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const usageLimitInfo = await getUserUsageLimitInfo(session.user.id)

    return NextResponse.json({
      currentLimit: usageLimitInfo.currentLimit,
      canEdit: usageLimitInfo.canEdit,
      minimumLimit: usageLimitInfo.minimumLimit,
      plan: usageLimitInfo.plan,
      setBy: usageLimitInfo.setBy,
      updatedAt: usageLimitInfo.updatedAt,
    })
  } catch (error) {
    logger.error('Failed to get usage limit', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { limit } = body

    if (typeof limit !== 'number' || limit <= 0) {
      return NextResponse.json({ error: 'Invalid limit value' }, { status: 400 })
    }

    const result = await updateUserUsageLimit(session.user.id, limit)

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    logger.info('User updated their usage limit', {
      userId: session.user.id,
      newLimit: limit,
    })

    return NextResponse.json({ success: true, newLimit: limit })
  } catch (error) {
    logger.error('Failed to update usage limit', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
