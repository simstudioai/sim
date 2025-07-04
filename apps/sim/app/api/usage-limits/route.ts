import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getUserUsageLimitInfo, updateUserUsageLimit } from '@/lib/billing'
import { updateMemberUsageLimit } from '@/lib/billing/core/organization-billing'
import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('UnifiedUsageLimitsAPI')

/**
 * Unified Usage Limits Endpoint
 * GET/PUT /api/usage-limits?context=user|member&userId=<id>&organizationId=<id>
 *
 * Replaces:
 * - /api/users/me/usage-limit
 * - /api/organizations/[id]/members/[memberId]/usage-limit
 */
export async function GET(request: NextRequest) {
  const session = await getSession()

  try {
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const context = searchParams.get('context') || 'user'
    const userId = searchParams.get('userId') || session.user.id
    const organizationId = searchParams.get('organizationId')

    // Validate context
    if (!['user', 'member'].includes(context)) {
      return NextResponse.json(
        { error: 'Invalid context. Must be "user" or "member"' },
        { status: 400 }
      )
    }

    // For member context, require organizationId
    if (context === 'member' && !organizationId) {
      return NextResponse.json(
        { error: 'Organization ID is required when context=member' },
        { status: 400 }
      )
    }

    // Get usage limit info (same for both contexts)
    const usageLimitInfo = await getUserUsageLimitInfo(userId)

    return NextResponse.json({
      success: true,
      context,
      userId,
      organizationId,
      data: usageLimitInfo,
    })
  } catch (error) {
    logger.error('Failed to get usage limit info', {
      userId: session?.user?.id,
      error,
    })

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  const session = await getSession()

  try {
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const context = searchParams.get('context') || 'user'
    const userId = searchParams.get('userId') || session.user.id
    const organizationId = searchParams.get('organizationId')

    const { limit } = await request.json()

    if (typeof limit !== 'number' || limit < 0) {
      return NextResponse.json(
        { error: 'Invalid limit. Must be a positive number' },
        { status: 400 }
      )
    }

    if (context === 'user') {
      // Update user's own usage limit
      if (userId !== session.user.id) {
        return NextResponse.json({ error: "Cannot update other users' limits" }, { status: 403 })
      }

      await updateUserUsageLimit(userId, limit)
    } else if (context === 'member') {
      // Update organization member's usage limit
      if (!organizationId) {
        return NextResponse.json(
          { error: 'Organization ID is required when context=member' },
          { status: 400 }
        )
      }

      await updateMemberUsageLimit(organizationId, userId, limit, session.user.id)
    } else {
      return NextResponse.json(
        { error: 'Invalid context. Must be "user" or "member"' },
        { status: 400 }
      )
    }

    // Return updated limit info
    const updatedInfo = await getUserUsageLimitInfo(userId)

    return NextResponse.json({
      success: true,
      context,
      userId,
      organizationId,
      data: updatedInfo,
    })
  } catch (error) {
    logger.error('Failed to update usage limit', {
      userId: session?.user?.id,
      error,
    })

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
