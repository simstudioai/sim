import { db, dbReplica } from '@sim/db'
import {
  member,
  organization as organizationTable,
  subscription as subscriptionTable,
  userStats,
  workspace as workspaceTable,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { isOrgAdminRole } from '@sim/platform-authz/workspace'
import { and, asc, desc, eq, isNull } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getBillingContract } from '@/lib/api/contracts/subscription'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { getOrganizationSubscription, getPersonalBillingSummary } from '@/lib/billing/core/billing'
import { getOrganizationBillingData } from '@/lib/billing/core/organization'
import { resolveBillingInterval } from '@/lib/billing/core/subscription'
import { getCreditBalanceForEntity } from '@/lib/billing/credits/balance'
import { isPaid } from '@/lib/billing/plan-helpers'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('UnifiedBillingAPI')

interface BillingBlockState {
  billingBlocked: boolean
  billingBlockedReason: 'payment_failed' | 'dispute' | null
  blockedByOrgOwner: boolean
}

/**
 * Finds an active workspace whose host billing identity is the requested payer.
 */
async function getUpgradeWorkspaceId(
  target: { type: 'user'; id: string } | { type: 'organization'; id: string }
): Promise<string | null> {
  const targetPredicate =
    target.type === 'organization'
      ? eq(workspaceTable.organizationId, target.id)
      : and(
          eq(workspaceTable.ownerId, target.id),
          eq(workspaceTable.billedAccountUserId, target.id),
          isNull(workspaceTable.organizationId)
        )

  const [workspace] = await dbReplica
    .select({ id: workspaceTable.id })
    .from(workspaceTable)
    .where(and(targetPredicate, isNull(workspaceTable.archivedAt)))
    .orderBy(asc(workspaceTable.createdAt), asc(workspaceTable.id))
    .limit(1)

  return workspace?.id ?? null
}

/**
 * Reads the exact organization's payer block from its owner, without allowing
 * the viewer's personal status or another organization membership to leak in.
 */
async function getOrganizationBillingBlockState(
  organizationId: string,
  viewerUserId: string
): Promise<BillingBlockState> {
  const [owner] = await dbReplica
    .select({ userId: member.userId })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.role, 'owner')))
    .limit(1)

  if (!owner) {
    return {
      billingBlocked: false,
      billingBlockedReason: null,
      blockedByOrgOwner: false,
    }
  }

  const [stats] = await dbReplica
    .select({
      billingBlocked: userStats.billingBlocked,
      billingBlockedReason: userStats.billingBlockedReason,
    })
    .from(userStats)
    .where(eq(userStats.userId, owner.userId))
    .limit(1)

  const billingBlocked = Boolean(stats?.billingBlocked)
  return {
    billingBlocked,
    billingBlockedReason: billingBlocked ? (stats?.billingBlockedReason ?? null) : null,
    blockedByOrgOwner: billingBlocked && owner.userId !== viewerUserId,
  }
}

/**
 * Unified Billing Endpoint
 */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const session = await getSession()

  try {
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(
      getBillingContract,
      request,
      {},
      {
        validationErrorResponse: () =>
          NextResponse.json(
            { error: 'Invalid context. Must be "user" or "organization"' },
            { status: 400 }
          ),
      }
    )
    if (!parsed.success) return parsed.response

    const { context, id: contextId, includeOrg } = parsed.data.query
    if (context === 'organization' && !contextId) {
      return NextResponse.json(
        { error: 'Organization ID is required when context=organization' },
        { status: 400 }
      )
    }

    if (context === 'user') {
      const [personalBilling, upgradeWorkspaceId] = await Promise.all([
        getPersonalBillingSummary(session.user.id, dbReplica),
        getUpgradeWorkspaceId({ type: 'user', id: session.user.id }),
      ])
      let organizationMembership: { id: string; role: 'owner' | 'admin' | 'member' } | undefined

      if (includeOrg) {
        const [userMembership] = await db
          .select({
            organizationId: member.organizationId,
            role: member.role,
          })
          .from(member)
          .where(eq(member.userId, session.user.id))
          .limit(1)

        if (userMembership) {
          organizationMembership = {
            id: userMembership.organizationId,
            role: userMembership.role as 'owner' | 'admin' | 'member',
          }
        }
      }

      return NextResponse.json({
        success: true,
        context,
        data: {
          ...personalBilling,
          upgradeWorkspaceId,
          ...(organizationMembership ? { organization: organizationMembership } : {}),
        },
      })
    }

    const organizationId = contextId!
    const [memberRecord] = await db
      .select({ role: member.role })
      .from(member)
      .where(and(eq(member.organizationId, organizationId), eq(member.userId, session.user.id)))
      .limit(1)

    if (!memberRecord) {
      return NextResponse.json(
        { error: 'Access denied - not a member of this organization' },
        { status: 403 }
      )
    }
    if (!isOrgAdminRole(memberRecord.role)) {
      return NextResponse.json(
        { error: 'Access denied - organization admin permission is required' },
        { status: 403 }
      )
    }

    const [
      rawBillingData,
      entitledSubscription,
      organizationRows,
      latestSubscriptionRows,
      creditBalance,
      billingStatus,
      upgradeWorkspaceId,
    ] = await Promise.all([
      getOrganizationBillingData(organizationId, dbReplica),
      getOrganizationSubscription(organizationId, { executor: dbReplica, onError: 'throw' }),
      dbReplica
        .select({ id: organizationTable.id, name: organizationTable.name })
        .from(organizationTable)
        .where(eq(organizationTable.id, organizationId))
        .limit(1),
      dbReplica
        .select()
        .from(subscriptionTable)
        .where(eq(subscriptionTable.referenceId, organizationId))
        .orderBy(desc(subscriptionTable.periodStart), desc(subscriptionTable.id))
        .limit(1),
      getCreditBalanceForEntity('organization', organizationId, dbReplica),
      getOrganizationBillingBlockState(organizationId, session.user.id),
      getUpgradeWorkspaceId({ type: 'organization', id: organizationId }),
    ])

    const organizationRecord = organizationRows[0]
    if (!organizationRecord) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
    }

    const latestSubscription = latestSubscriptionRows[0] ?? null
    const activeSubscription =
      entitledSubscription && isPaid(entitledSubscription.plan) ? entitledSubscription : null
    const freeSubscription =
      entitledSubscription && !isPaid(entitledSubscription.plan) ? entitledSubscription : null
    const lapsedSubscription =
      !entitledSubscription && latestSubscription && isPaid(latestSubscription.plan)
        ? latestSubscription
        : null
    const displayedSubscription = activeSubscription ?? freeSubscription ?? lapsedSubscription
    const subscriptionState = activeSubscription
      ? ('active' as const)
      : lapsedSubscription
        ? ('lapsed' as const)
        : ('free' as const)

    const billingData = {
      organizationId,
      organizationName: rawBillingData?.organizationName ?? organizationRecord.name ?? '',
      subscriptionState,
      hasSubscription: displayedSubscription !== null,
      subscriptionPlan: displayedSubscription?.plan ?? 'free',
      subscriptionStatus: displayedSubscription?.status ?? null,
      creditBalance,
      billingInterval: resolveBillingInterval(displayedSubscription),
      cancelAtPeriodEnd: displayedSubscription?.cancelAtPeriodEnd ?? false,
      totalSeats: rawBillingData?.totalSeats ?? 0,
      usedSeats: rawBillingData?.usedSeats ?? 0,
      seatsCount: rawBillingData?.seatsCount ?? 0,
      totalCurrentUsage: rawBillingData?.totalCurrentUsage ?? 0,
      totalUsageLimit: rawBillingData?.totalUsageLimit ?? 0,
      minimumBillingAmount: rawBillingData?.minimumBillingAmount ?? 0,
      averageUsagePerMember: rawBillingData?.averageUsagePerMember ?? 0,
      billingPeriodStart:
        rawBillingData?.billingPeriodStart?.toISOString() ??
        displayedSubscription?.periodStart?.toISOString() ??
        null,
      billingPeriodEnd:
        rawBillingData?.billingPeriodEnd?.toISOString() ??
        displayedSubscription?.periodEnd?.toISOString() ??
        null,
      members:
        rawBillingData?.members.map((organizationMember) => ({
          ...organizationMember,
          joinedAt: organizationMember.joinedAt.toISOString(),
        })) ?? [],
      ...billingStatus,
      upgradeWorkspaceId,
    }

    return NextResponse.json({
      success: true,
      context,
      data: billingData,
      userRole: memberRecord.role as 'owner' | 'admin' | 'member',
      ...billingStatus,
    })
  } catch (error) {
    logger.error('Failed to get billing data', {
      userId: session?.user?.id,
      error,
    })

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})
