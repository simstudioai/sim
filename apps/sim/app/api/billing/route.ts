import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getSimplifiedBillingSummary } from '@/lib/billing/core/billing'
import { getOrganizationBillingData } from '@/lib/billing/core/organization-billing'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { member } from '@/db/schema'

const logger = createLogger('UnifiedBillingAPI')

/**
 * Unified Billing Endpoint
 */
export async function GET(request: NextRequest) {
  const session = await getSession()

  try {
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const context = searchParams.get('context') || 'user'
    const contextId = searchParams.get('id')

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
      // Get user billing (may include organization if they're part of one)
      billingData = await getSimplifiedBillingSummary(session.user.id, contextId || undefined)
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

      // Transform data to match component expectations
      billingData = {
        organizationId: rawBillingData.organizationId,
        organizationName: rawBillingData.organizationName,
        subscriptionPlan: rawBillingData.subscriptionPlan,
        subscriptionStatus: rawBillingData.subscriptionStatus,
        totalSeats: rawBillingData.totalSeats,
        usedSeats: rawBillingData.usedSeats,
        totalCurrentUsage: rawBillingData.totalCurrentUsage,
        totalUsageLimit: rawBillingData.totalUsageLimit,
        averageUsagePerMember: rawBillingData.averageUsagePerMember,
        billingPeriodStart: rawBillingData.billingPeriodStart?.toISOString() || null,
        billingPeriodEnd: rawBillingData.billingPeriodEnd?.toISOString() || null,
        members: rawBillingData.members.map((member) => ({
          ...member,
          joinedAt: member.joinedAt.toISOString(),
          lastActive: member.lastActive?.toISOString() || null,
        })),
      }

      const userRole = memberRecord[0].role

      return NextResponse.json({
        success: true,
        context,
        data: billingData,
        userRole,
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
}
