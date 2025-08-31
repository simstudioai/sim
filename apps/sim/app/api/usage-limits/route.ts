import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getUserUsageLimitInfo, updateUserUsageLimit } from '@/lib/billing'
import {
  getOrganizationBillingData,
  isOrganizationOwnerOrAdmin,
} from '@/lib/billing/core/organization'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('UnifiedUsageLimitsAPI')

/**
 * Unified Usage Limits Endpoint
 * GET/PUT /api/usage-limits?context=user|organization&userId=<id>&organizationId=<id>
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

    if (!['user', 'organization'].includes(context)) {
      return NextResponse.json(
        { error: 'Invalid context. Must be "user" or "organization"' },
        { status: 400 }
      )
    }

    if (context === 'user' && userId !== session.user.id) {
      return NextResponse.json(
        { error: "Cannot view other users' usage information" },
        { status: 403 }
      )
    }

    if (context === 'organization') {
      if (!organizationId) {
        return NextResponse.json(
          { error: 'Organization ID is required when context=organization' },
          { status: 400 }
        )
      }
      const org = await getOrganizationBillingData(organizationId)
      return NextResponse.json({
        success: true,
        context,
        userId,
        organizationId,
        data: org,
      })
    }

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

    const body = await request.json()
    const limit = body?.limit
    const context = body?.context || 'user'
    const organizationId = body?.organizationId
    const userId = session.user.id

    if (typeof limit !== 'number' || limit < 0) {
      return NextResponse.json(
        { error: 'Invalid limit. Must be a positive number' },
        { status: 400 }
      )
    }

    if (!['user', 'organization'].includes(context)) {
      return NextResponse.json(
        { error: 'Invalid context. Must be "user" or "organization"' },
        { status: 400 }
      )
    }

    if (context === 'user') {
      await updateUserUsageLimit(userId, limit)
    } else if (context === 'organization') {
      if (!organizationId) {
        return NextResponse.json(
          { error: 'Organization ID is required when context=organization' },
          { status: 400 }
        )
      }

      const hasPermission = await isOrganizationOwnerOrAdmin(session.user.id, organizationId)
      if (!hasPermission) {
        return NextResponse.json({ error: 'Permission denied' }, { status: 403 })
      }

      const { updateOrganizationUsageLimit } = await import('@/lib/billing/core/organization')
      const result = await updateOrganizationUsageLimit(organizationId, limit)

      if (!result.success) {
        return NextResponse.json({ error: result.error }, { status: 400 })
      }

      const updated = await getOrganizationBillingData(organizationId)
      return NextResponse.json({ success: true, context, userId, organizationId, data: updated })
    }

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
