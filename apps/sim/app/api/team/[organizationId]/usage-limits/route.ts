import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { getTeamUsageLimits } from '@/lib/usage-limits'
import { db } from '@/db'
import { member } from '@/db/schema'

const logger = createLogger('TeamUsageLimitsAPI')

export async function GET(
  request: NextRequest,
  { params }: { params: { organizationId: string } }
) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { organizationId } = params

    // Check if user is admin/owner of the organization
    const memberRecord = await db
      .select()
      .from(member)
      .where(and(eq(member.userId, session.user.id), eq(member.organizationId, organizationId)))
      .limit(1)

    if (memberRecord.length === 0 || !['admin', 'owner'].includes(memberRecord[0].role)) {
      return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 })
    }

    const teamUsageLimits = await getTeamUsageLimits(organizationId)

    return NextResponse.json({ teamUsageLimits })
  } catch (error) {
    logger.error('Failed to get team usage limits', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
