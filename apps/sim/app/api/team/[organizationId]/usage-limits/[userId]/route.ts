import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { updateUserUsageLimit } from '@/lib/usage-limits'
import { db } from '@/db'
import { member } from '@/db/schema'

const logger = createLogger('TeamMemberUsageLimitAPI')

export async function PUT(
  request: NextRequest,
  { params }: { params: { organizationId: string; userId: string } }
) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { organizationId, userId } = params

    // Check if current user is admin/owner of the organization
    const adminMemberRecord = await db
      .select()
      .from(member)
      .where(and(eq(member.userId, session.user.id), eq(member.organizationId, organizationId)))
      .limit(1)

    if (adminMemberRecord.length === 0 || !['admin', 'owner'].includes(adminMemberRecord[0].role)) {
      return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 })
    }

    // Check if target user is a member of the organization
    const targetMemberRecord = await db
      .select()
      .from(member)
      .where(and(eq(member.userId, userId), eq(member.organizationId, organizationId)))
      .limit(1)

    if (targetMemberRecord.length === 0) {
      return NextResponse.json(
        { error: 'User is not a member of this organization' },
        { status: 400 }
      )
    }

    const body = await request.json()
    const { limit } = body

    if (typeof limit !== 'number' || limit <= 0) {
      return NextResponse.json({ error: 'Invalid limit value' }, { status: 400 })
    }

    const result = await updateUserUsageLimit(userId, limit, session.user.id)

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    logger.info('Admin updated team member usage limit', {
      adminId: session.user.id,
      targetUserId: userId,
      organizationId,
      newLimit: limit,
    })

    return NextResponse.json({ success: true, newLimit: limit })
  } catch (error) {
    logger.error('Failed to update team member usage limit', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
