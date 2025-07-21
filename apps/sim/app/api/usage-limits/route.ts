import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getUserUsageLimitInfo, updateUserUsageLimit } from '@/lib/billing'
import { updateMemberUsageLimit } from '@/lib/billing/core/organization-billing'
import { createLogger } from '@/lib/logs/console-logger'
import { isOrganizationOwnerOrAdmin } from '@/lib/permissions/utils'

const logger = createLogger('UnifiedUsageLimitsAPI')

/**
 * Unified Usage Limits Endpoint
 * GET/PUT /api/usage-limits?context=user|member&userId=<id>&organizationId=<id>
 *
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

    // For member context, require organizationId and check permissions
    if (context === 'member') {
      if (!organizationId) {
        return NextResponse.json(
          { error: 'Organization ID is required when context=member' },
          { status: 400 }
        )
      }

      // Check if the current user has permission to view member usage info
      const hasPermission = await isOrganizationOwnerOrAdmin(session.user.id, organizationId)
      if (!hasPermission) {
        logger.warn('Unauthorized attempt to view member usage info', {
          requesterId: session.user.id,
          targetUserId: userId,
          organizationId,
        })
        return NextResponse.json(
          {
            error:
              'Permission denied. Only organization owners and admins can view member usage information',
          },
          { status: 403 }
        )
      }
    }

    // For user context, ensure they can only view their own info
    if (context === 'user' && userId !== session.user.id) {
      return NextResponse.json(
        { error: "Cannot view other users' usage information" },
        { status: 403 }
      )
    }

    // Get usage limit info
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

      // Check if the current user has permission to update member limits
      const hasPermission = await isOrganizationOwnerOrAdmin(session.user.id, organizationId)
      if (!hasPermission) {
        logger.warn('Unauthorized attempt to update member usage limit', {
          adminUserId: session.user.id,
          targetUserId: userId,
          organizationId,
        })
        return NextResponse.json(
          {
            error:
              'Permission denied. Only organization owners and admins can update member usage limits',
          },
          { status: 403 }
        )
      }

      logger.info('Authorized member usage limit update', {
        adminUserId: session.user.id,
        targetUserId: userId,
        organizationId,
        newLimit: limit,
      })

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

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
