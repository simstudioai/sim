import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { updateMemberUsageLimit } from '@/lib/billing/core/organization-billing'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import * as schema from '@/db/schema'

const logger = createLogger('MemberUsageLimitAPI')

/**
 * PUT /api/organizations/[id]/billing/members/[memberId]/usage-limit
 * Update usage limit for an organization member
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string; memberId: string } }
) {
  try {
    const session = await getSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: organizationId, memberId } = params
    const { limit } = await request.json()

    // Validate input
    if (typeof limit !== 'number' || limit < 0) {
      return NextResponse.json({ error: 'Invalid limit value' }, { status: 400 })
    }

    // Verify admin has permission
    const adminMember = await db
      .select()
      .from(schema.member)
      .where(
        and(
          eq(schema.member.organizationId, organizationId),
          eq(schema.member.userId, session.user.id)
        )
      )
      .limit(1)

    if (adminMember.length === 0) {
      return NextResponse.json(
        { error: 'Forbidden - Not a member of this organization' },
        { status: 403 }
      )
    }

    if (!['owner', 'admin'].includes(adminMember[0].role)) {
      return NextResponse.json({ error: 'Forbidden - Insufficient permissions' }, { status: 403 })
    }

    // Update the member's usage limit
    await updateMemberUsageLimit(organizationId, memberId, limit, session.user.id)

    logger.info('Member usage limit updated', {
      organizationId,
      memberId,
      newLimit: limit,
      adminUserId: session.user.id,
    })

    return NextResponse.json({
      success: true,
      message: 'Usage limit updated successfully',
      data: {
        memberId,
        newLimit: limit,
        updatedBy: session.user.id,
        updatedAt: new Date().toISOString(),
      },
    })
  } catch (error) {
    logger.error('Failed to update member usage limit', {
      organizationId: params.id,
      memberId: params.memberId,
      error,
    })

    const errorMessage = error instanceof Error ? error.message : 'Internal server error'
    const statusCode =
      errorMessage.includes('permissions') || errorMessage.includes('not found') ? 400 : 500

    return NextResponse.json({ error: errorMessage }, { status: statusCode })
  }
}
