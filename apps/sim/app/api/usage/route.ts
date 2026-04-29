import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { updateUsageLimitBodySchema, usageQuerySchema } from '@/lib/api/contracts/subscription'
import { getValidationErrorMessage, validateSchema } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { getUserUsageLimitInfo, updateUserUsageLimit } from '@/lib/billing'
import {
  getOrganizationBillingData,
  isOrganizationOwnerOrAdmin,
} from '@/lib/billing/core/organization'
import { isUserMemberOfOrganization } from '@/lib/billing/organizations/membership'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('UnifiedUsageAPI')

/**
 * Unified Usage Endpoint
 * GET/PUT /api/usage?context=user|organization&userId=<id>&organizationId=<id>
 *
 */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const session = await getSession()

  try {
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const queryResult = usageQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams.entries())
    )
    if (!queryResult.success) {
      return NextResponse.json(
        { error: 'Invalid context. Must be "user" or "organization"' },
        { status: 400 }
      )
    }
    const { context, userId = session.user.id, organizationId } = queryResult.data

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

      const membership = await isUserMemberOfOrganization(session.user.id, organizationId)
      if (!membership.isMember) {
        return NextResponse.json({ error: 'Permission denied' }, { status: 403 })
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
      organizationId: organizationId ?? null,
      data: usageLimitInfo,
    })
  } catch (error) {
    logger.error('Failed to get usage limit info', {
      userId: session?.user?.id,
      error,
    })

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})

export const PUT = withRouteHandler(async (request: NextRequest) => {
  const session = await getSession()

  try {
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const validation = validateSchema(updateUsageLimitBodySchema, body)

    if (!validation.success) {
      const message = getValidationErrorMessage(validation.error)
      logger.error('Validation error:', message)
      return NextResponse.json({ error: message }, { status: 400 })
    }

    const { limit, context, organizationId } = validation.data
    const userId = session.user.id

    if (context === 'user') {
      const result = await updateUserUsageLimit(userId, limit)
      if (!result.success) {
        return NextResponse.json({ error: result.error }, { status: 400 })
      }
    } else if (context === 'organization') {
      // organizationId is guaranteed to exist by Zod refinement
      const hasPermission = await isOrganizationOwnerOrAdmin(session.user.id, organizationId!)
      if (!hasPermission) {
        return NextResponse.json({ error: 'Permission denied' }, { status: 403 })
      }

      const { updateOrganizationUsageLimit } = await import('@/lib/billing/core/organization')
      const result = await updateOrganizationUsageLimit(organizationId!, limit)

      if (!result.success) {
        return NextResponse.json({ error: result.error }, { status: 400 })
      }

      const updated = await getOrganizationBillingData(organizationId!)
      return NextResponse.json({ success: true, context, userId, organizationId, data: updated })
    }

    const updatedInfo = await getUserUsageLimitInfo(userId)

    return NextResponse.json({
      success: true,
      context,
      userId,
      organizationId: organizationId ?? null,
      data: updatedInfo,
    })
  } catch (error) {
    logger.error('Failed to update usage limit', {
      userId: session?.user?.id,
      error,
    })

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})
