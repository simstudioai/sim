import { db } from '@sim/db'
import { member } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getEffectiveBillingStatus } from '@/lib/billing/core/access'
import { getSimplifiedBillingSummary } from '@/lib/billing/core/billing'
import { getOrganizationBillingData } from '@/lib/billing/core/organization'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('UnifiedBillingAPI')

/**
 * Unified Billing Endpoint
 */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const session = await getSession()

  try {
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const context = searchParams.get('context') || 'user'
    const contextId = searchParams.get('id')
    const includeOrg = searchParams.get('includeOrg') === 'true'

    // Validate context parameter
    if (!['user', 'organization'].includes(context)) {
      return NextResponse.json(
        { error: 'Invalid context. Must be "user" or "organization"' },
        { status: 400 }
      )
    }

    // For organization context, require contextId
    if (context === 'organization' && !contextId) {
      return NextResponse.json(
        { error: 'Organization ID is required when context=organization' },
        { status: 400 }
      )
    }

    let billingData

    if (context === 'user') {
      if (contextId) {
        const membership = await db
          .select({ role: member.role })
          .from(member)
          .where(and(eq(member.organizationId, contextId), eq(member.userId, session.user.id)))
          .limit(1)
        if (membership.length === 0) {
          return NextResponse.json(
            { error: 'Access denied - not a member of this organization' },
            { status: 403 }
          )
        }
      }

      const [billingResult, billingStatus] = await Promise.all([
        getSimplifiedBillingSummary(session.user.id, contextId || undefined),
        getEffectiveBillingStatus(session.user.id),
      ])
      billingData = billingResult

      billingData = {
        ...billingData,
        billingBlocked: billingStatus.billingBlocked,
        billingBlockedReason: billingStatus.billingBlockedReason,
        blockedByOrgOwner: billingStatus.blockedByOrgOwner,
      }

      // Optionally include organization membership and role
      if (includeOrg) {
        const userMembership = await db
          .select({
            organizationId: member.organizationId,
            role: member.role,
          })
          .from(member)
          .where(eq(member.userId, session.user.id))
          .limit(1)

        if (userMembership.length > 0) {
          billingData = {
            ...billingData,
            organization: {
              id: userMembership[0].organizationId,
              role: userMembership[0].role as 'owner' | 'admin' | 'member',
            },
          }
        }
      }
    } else {
      // Get user role in organization for permission checks first
      const memberRecord = await db
        .select({ role: member.role })
        .from(member)
        .where(and(eq(member.organizationId, contextId!), eq(member.userId, session.user.id)))
        .limit(1)

      if (memberRecord.length === 0) {
        return NextResponse.json(
          { error: 'Access denied - not a member of this organization' },
          { status: 403 }
        )
      }

      // Get organization-specific billing
      const rawBillingData = await getOrganizationBillingData(contextId!)

      if (!rawBillingData) {
        return NextResponse.json(
          { error: 'Organization not found or access denied' },
          { status: 404 }
        )
      }

      billingData = {
        organizationId: rawBillingData.organizationId,
        organizationName: rawBillingData.organizationName,
        subscriptionPlan: rawBillingData.subscriptionPlan,
        subscriptionStatus: rawBillingData.subscriptionStatus,
        totalSeats: rawBillingData.totalSeats,
        usedSeats: rawBillingData.usedSeats,
        seatsCount: rawBillingData.seatsCount,
        totalCurrentUsage: rawBillingData.totalCurrentUsage,
        totalUsageLimit: rawBillingData.totalUsageLimit,
        minimumBillingAmount: rawBillingData.minimumBillingAmount,
        averageUsagePerMember: rawBillingData.averageUsagePerMember,
        billingPeriodStart: rawBillingData.billingPeriodStart?.toISOString() || null,
        billingPeriodEnd: rawBillingData.billingPeriodEnd?.toISOString() || null,
        members: rawBillingData.members.map((m) => ({
          ...m,
          joinedAt: m.joinedAt.toISOString(),
          lastActive: m.lastActive?.toISOString() || null,
        })),
      }

      const userRole = memberRecord[0].role

      // Get effective billing blocked status (includes org owner check)
      const billingStatus = await getEffectiveBillingStatus(session.user.id)

      // Merge blocked flag into data for convenience
      billingData = {
        ...billingData,
        billingBlocked: billingStatus.billingBlocked,
        billingBlockedReason: billingStatus.billingBlockedReason,
        blockedByOrgOwner: billingStatus.blockedByOrgOwner,
      }

      return NextResponse.json({
        success: true,
        context,
        data: billingData,
        userRole,
        billingBlocked: billingData.billingBlocked,
        billingBlockedReason: billingData.billingBlockedReason,
        blockedByOrgOwner: billingData.blockedByOrgOwner,
      })
    }

    return NextResponse.json({
      success: true,
      context,
      data: billingData,
    })
  } catch (error) {
    logger.error('Failed to get billing data', {
      userId: session?.user?.id,
      error,
    })

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})
