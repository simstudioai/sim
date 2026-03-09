/**
 * GET /api/v1/admin/organizations/[id]/members
 *
 * List all members of an organization with their billing info.
 *
 * Query Parameters:
 *   - limit: number (default: 50, max: 250)
 *   - offset: number (default: 0)
 *
 * Response: AdminListResponse<AdminMemberDetail>
 *
 * POST /api/v1/admin/organizations/[id]/members
 *
 * Add a user to an organization with full billing logic.
 * Validates seat availability before adding (uses same logic as invitation flow):
 *   - Team plans: checks seats column
 *   - Enterprise plans: checks metadata.seats
 * Handles Pro usage snapshot and subscription cancellation like the invitation flow.
 * If user is already a member, updates their role if different.
 *
 * Body:
 *   - userId: string - User ID to add
 *   - role: string - Role ('admin' | 'member')
 *
 * Response: AdminSingleResponse<AdminMember & {
 *   action: 'created' | 'updated' | 'already_member',
 *   billingActions: { proUsageSnapshotted, proCancelledAtPeriodEnd }
 * }>
 */

import { db } from '@sim/db'
import { member, organization, user, userStats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { count, eq } from 'drizzle-orm'
import { addUserToOrganization } from '@/lib/billing/organizations/membership'
import { requireStripeClient } from '@/lib/billing/stripe-client'
import { isBillingEnabled } from '@/lib/core/config/feature-flags'
import { withAdminAuthParams } from '@/app/api/v1/admin/middleware'
import {
  badRequestResponse,
  internalErrorResponse,
  listResponse,
  notFoundResponse,
  singleResponse,
} from '@/app/api/v1/admin/responses'
import {
  type AdminMember,
  type AdminMemberDetail,
  createPaginationMeta,
  parsePaginationParams,
} from '@/app/api/v1/admin/types'

const logger = createLogger('AdminOrganizationMembersAPI')

interface RouteParams {
  id: string
}

export const GET = withAdminAuthParams<RouteParams>(async (request, context) => {
  const { id: organizationId } = await context.params
  const url = new URL(request.url)
  const { limit, offset } = parsePaginationParams(url)

  try {
    const [orgData] = await db
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.id, organizationId))
      .limit(1)

    if (!orgData) {
      return notFoundResponse('Organization')
    }

    const [countResult, membersData] = await Promise.all([
      db.select({ count: count() }).from(member).where(eq(member.organizationId, organizationId)),
      db
        .select({
          id: member.id,
          userId: member.userId,
          organizationId: member.organizationId,
          role: member.role,
          createdAt: member.createdAt,
          userName: user.name,
          userEmail: user.email,
          currentPeriodCost: userStats.currentPeriodCost,
          currentUsageLimit: userStats.currentUsageLimit,
          lastActive: userStats.lastActive,
          billingBlocked: userStats.billingBlocked,
        })
        .from(member)
        .innerJoin(user, eq(member.userId, user.id))
        .leftJoin(userStats, eq(member.userId, userStats.userId))
        .where(eq(member.organizationId, organizationId))
        .orderBy(member.createdAt)
        .limit(limit)
        .offset(offset),
    ])

    const total = countResult[0].count
    const data: AdminMemberDetail[] = membersData.map((m) => ({
      id: m.id,
      userId: m.userId,
      organizationId: m.organizationId,
      role: m.role,
      createdAt: m.createdAt.toISOString(),
      userName: m.userName,
      userEmail: m.userEmail,
      currentPeriodCost: m.currentPeriodCost ?? '0',
      currentUsageLimit: m.currentUsageLimit,
      lastActive: m.lastActive?.toISOString() ?? null,
      billingBlocked: m.billingBlocked ?? false,
    }))

    const pagination = createPaginationMeta(total, limit, offset)

    logger.info(`Admin API: Listed ${data.length} members for organization ${organizationId}`)

    return listResponse(data, pagination)
  } catch (error) {
    logger.error('Admin API: Failed to list organization members', { error, organizationId })
    return internalErrorResponse('Failed to list organization members')
  }
})

export const POST = withAdminAuthParams<RouteParams>(async (request, context) => {
  const { id: organizationId } = await context.params

  try {
    const body = await request.json()

    if (!body.userId || typeof body.userId !== 'string') {
      return badRequestResponse('userId is required')
    }

    if (!body.role || !['admin', 'member'].includes(body.role)) {
      return badRequestResponse('role must be "admin" or "member"')
    }

    const [orgData] = await db
      .select({ id: organization.id, name: organization.name })
      .from(organization)
      .where(eq(organization.id, organizationId))
      .limit(1)

    if (!orgData) {
      return notFoundResponse('Organization')
    }

    const [userData] = await db
      .select({ id: user.id, name: user.name, email: user.email })
      .from(user)
      .where(eq(user.id, body.userId))
      .limit(1)

    if (!userData) {
      return notFoundResponse('User')
    }

    const [existingMember] = await db
      .select({
        id: member.id,
        role: member.role,
        createdAt: member.createdAt,
        organizationId: member.organizationId,
      })
      .from(member)
      .where(eq(member.userId, body.userId))
      .limit(1)

    if (existingMember) {
      if (existingMember.organizationId === organizationId) {
        if (existingMember.role !== body.role) {
          await db.update(member).set({ role: body.role }).where(eq(member.id, existingMember.id))

          logger.info(
            `Admin API: Updated user ${body.userId} role in organization ${organizationId}`,
            {
              previousRole: existingMember.role,
              newRole: body.role,
            }
          )

          return singleResponse({
            id: existingMember.id,
            userId: body.userId,
            organizationId,
            role: body.role,
            createdAt: existingMember.createdAt.toISOString(),
            userName: userData.name,
            userEmail: userData.email,
            action: 'updated' as const,
            billingActions: {
              proUsageSnapshotted: false,
              proCancelledAtPeriodEnd: false,
            },
          })
        }

        return singleResponse({
          id: existingMember.id,
          userId: body.userId,
          organizationId,
          role: existingMember.role,
          createdAt: existingMember.createdAt.toISOString(),
          userName: userData.name,
          userEmail: userData.email,
          action: 'already_member' as const,
          billingActions: {
            proUsageSnapshotted: false,
            proCancelledAtPeriodEnd: false,
          },
        })
      }

      return badRequestResponse(
        `User is already a member of another organization. Users can only belong to one organization at a time.`
      )
    }

    const result = await addUserToOrganization({
      userId: body.userId,
      organizationId,
      role: body.role,
      skipBillingLogic: !isBillingEnabled,
    })

    if (!result.success) {
      return badRequestResponse(result.error || 'Failed to add member')
    }

    if (isBillingEnabled && result.billingActions.proSubscriptionToCancel?.stripeSubscriptionId) {
      try {
        const stripe = requireStripeClient()
        await stripe.subscriptions.update(
          result.billingActions.proSubscriptionToCancel.stripeSubscriptionId,
          { cancel_at_period_end: true }
        )
        logger.info('Admin API: Synced Pro cancellation with Stripe', {
          userId: body.userId,
          subscriptionId: result.billingActions.proSubscriptionToCancel.subscriptionId,
          stripeSubscriptionId: result.billingActions.proSubscriptionToCancel.stripeSubscriptionId,
        })
      } catch (stripeError) {
        logger.error('Admin API: Failed to sync Pro cancellation with Stripe', {
          userId: body.userId,
          subscriptionId: result.billingActions.proSubscriptionToCancel.subscriptionId,
          stripeSubscriptionId: result.billingActions.proSubscriptionToCancel.stripeSubscriptionId,
          error: stripeError,
        })
      }
    }

    const data: AdminMember = {
      id: result.memberId!,
      userId: body.userId,
      organizationId,
      role: body.role,
      createdAt: new Date().toISOString(),
      userName: userData.name,
      userEmail: userData.email,
    }

    logger.info(`Admin API: Added user ${body.userId} to organization ${organizationId}`, {
      role: body.role,
      memberId: result.memberId,
      billingActions: result.billingActions,
    })

    return singleResponse({
      ...data,
      action: 'created' as const,
      billingActions: {
        proUsageSnapshotted: result.billingActions.proUsageSnapshotted,
        proCancelledAtPeriodEnd: result.billingActions.proCancelledAtPeriodEnd,
      },
    })
  } catch (error) {
    logger.error('Admin API: Failed to add organization member', { error, organizationId })
    return internalErrorResponse('Failed to add organization member')
  }
})
