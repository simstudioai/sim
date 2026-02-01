/**
 * GET /api/v1/admin/users/[id]/billing
 *
 * Get user billing information including usage stats, subscriptions, and org memberships.
 *
 * Response: AdminSingleResponse<AdminUserBillingWithSubscription>
 *
 * PATCH /api/v1/admin/users/[id]/billing
 *
 * Update user billing settings with proper validation.
 *
 * Body:
 *   - currentUsageLimit?: number | null - Usage limit (null to use default)
 *   - billingBlocked?: boolean - Block/unblock billing
 *   - currentPeriodCost?: number - Reset/adjust current period cost (use with caution)
 *   - reason?: string - Reason for the change (for audit logging)
 *
 * Response: AdminSingleResponse<{ success: true, updated: string[], warnings: string[] }>
 */

import { db } from '@sim/db'
import { member, organization, subscription, user, userStats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq, or } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { getHighestPrioritySubscription } from '@/lib/billing/core/subscription'
import { withAdminAuthParams } from '@/app/api/v1/admin/middleware'
import {
  badRequestResponse,
  internalErrorResponse,
  notFoundResponse,
  singleResponse,
} from '@/app/api/v1/admin/responses'
import {
  type AdminUserBillingWithSubscription,
  toAdminSubscription,
} from '@/app/api/v1/admin/types'

const logger = createLogger('AdminUserBillingAPI')

interface RouteParams {
  id: string
}

export const GET = withAdminAuthParams<RouteParams>(async (_, context) => {
  const { id: userId } = await context.params

  try {
    const [userData] = await db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        stripeCustomerId: user.stripeCustomerId,
      })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1)

    if (!userData) {
      return notFoundResponse('User')
    }

    const [stats] = await db.select().from(userStats).where(eq(userStats.userId, userId)).limit(1)

    const memberOrgs = await db
      .select({
        organizationId: member.organizationId,
        organizationName: organization.name,
        role: member.role,
      })
      .from(member)
      .innerJoin(organization, eq(member.organizationId, organization.id))
      .where(eq(member.userId, userId))

    const orgIds = memberOrgs.map((m) => m.organizationId)

    const subscriptions = await db
      .select()
      .from(subscription)
      .where(
        orgIds.length > 0
          ? or(
              eq(subscription.referenceId, userId),
              ...orgIds.map((orgId) => eq(subscription.referenceId, orgId))
            )
          : eq(subscription.referenceId, userId)
      )

    const data: AdminUserBillingWithSubscription = {
      userId: userData.id,
      userName: userData.name,
      userEmail: userData.email,
      stripeCustomerId: userData.stripeCustomerId,
      totalManualExecutions: stats?.totalManualExecutions ?? 0,
      totalApiCalls: stats?.totalApiCalls ?? 0,
      totalWebhookTriggers: stats?.totalWebhookTriggers ?? 0,
      totalScheduledExecutions: stats?.totalScheduledExecutions ?? 0,
      totalChatExecutions: stats?.totalChatExecutions ?? 0,
      totalMcpExecutions: stats?.totalMcpExecutions ?? 0,
      totalA2aExecutions: stats?.totalA2aExecutions ?? 0,
      totalTokensUsed: stats?.totalTokensUsed ?? 0,
      totalCost: stats?.totalCost ?? '0',
      currentUsageLimit: stats?.currentUsageLimit ?? null,
      currentPeriodCost: stats?.currentPeriodCost ?? '0',
      lastPeriodCost: stats?.lastPeriodCost ?? null,
      billedOverageThisPeriod: stats?.billedOverageThisPeriod ?? '0',
      storageUsedBytes: stats?.storageUsedBytes ?? 0,
      lastActive: stats?.lastActive?.toISOString() ?? null,
      billingBlocked: stats?.billingBlocked ?? false,
      totalCopilotCost: stats?.totalCopilotCost ?? '0',
      currentPeriodCopilotCost: stats?.currentPeriodCopilotCost ?? '0',
      lastPeriodCopilotCost: stats?.lastPeriodCopilotCost ?? null,
      totalCopilotTokens: stats?.totalCopilotTokens ?? 0,
      totalCopilotCalls: stats?.totalCopilotCalls ?? 0,
      subscriptions: subscriptions.map(toAdminSubscription),
      organizationMemberships: memberOrgs.map((m) => ({
        organizationId: m.organizationId,
        organizationName: m.organizationName,
        role: m.role,
      })),
    }

    logger.info(`Admin API: Retrieved billing for user ${userId}`)

    return singleResponse(data)
  } catch (error) {
    logger.error('Admin API: Failed to get user billing', { error, userId })
    return internalErrorResponse('Failed to get user billing')
  }
})

export const PATCH = withAdminAuthParams<RouteParams>(async (request, context) => {
  const { id: userId } = await context.params

  try {
    const body = await request.json()
    const reason = body.reason || 'Admin update (no reason provided)'

    const [userData] = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1)

    if (!userData) {
      return notFoundResponse('User')
    }

    const [existingStats] = await db
      .select()
      .from(userStats)
      .where(eq(userStats.userId, userId))
      .limit(1)

    const userSubscription = await getHighestPrioritySubscription(userId)
    const isTeamOrEnterpriseMember =
      userSubscription && ['team', 'enterprise'].includes(userSubscription.plan)

    const [orgMembership] = await db
      .select({ organizationId: member.organizationId })
      .from(member)
      .where(eq(member.userId, userId))
      .limit(1)

    const updateData: Record<string, unknown> = {}
    const updated: string[] = []
    const warnings: string[] = []

    if (body.currentUsageLimit !== undefined) {
      if (isTeamOrEnterpriseMember && orgMembership) {
        warnings.push(
          'User is a team/enterprise member. Individual limits may be ignored in favor of organization limits.'
        )
      }

      if (body.currentUsageLimit === null) {
        updateData.currentUsageLimit = null
      } else if (typeof body.currentUsageLimit === 'number' && body.currentUsageLimit >= 0) {
        const currentCost = Number.parseFloat(existingStats?.currentPeriodCost || '0')
        if (body.currentUsageLimit < currentCost) {
          warnings.push(
            `New limit ($${body.currentUsageLimit.toFixed(2)}) is below current usage ($${currentCost.toFixed(2)}). User may be immediately blocked.`
          )
        }
        updateData.currentUsageLimit = body.currentUsageLimit.toFixed(2)
      } else {
        return badRequestResponse('currentUsageLimit must be a non-negative number or null')
      }
      updateData.usageLimitUpdatedAt = new Date()
      updated.push('currentUsageLimit')
    }

    if (body.billingBlocked !== undefined) {
      if (typeof body.billingBlocked !== 'boolean') {
        return badRequestResponse('billingBlocked must be a boolean')
      }

      if (body.billingBlocked === false && existingStats?.billingBlocked === true) {
        warnings.push(
          'Unblocking user. Ensure payment issues are resolved to prevent re-blocking on next invoice.'
        )
      }

      updateData.billingBlocked = body.billingBlocked
      // Clear the reason when unblocking
      if (body.billingBlocked === false) {
        updateData.billingBlockedReason = null
      }
      updated.push('billingBlocked')
    }

    if (body.currentPeriodCost !== undefined) {
      if (typeof body.currentPeriodCost !== 'number' || body.currentPeriodCost < 0) {
        return badRequestResponse('currentPeriodCost must be a non-negative number')
      }

      const previousCost = existingStats?.currentPeriodCost || '0'
      warnings.push(
        `Manually adjusting currentPeriodCost from $${previousCost} to $${body.currentPeriodCost.toFixed(2)}. This may affect billing accuracy.`
      )

      updateData.currentPeriodCost = body.currentPeriodCost.toFixed(2)
      updated.push('currentPeriodCost')
    }

    if (updated.length === 0) {
      return badRequestResponse('No valid fields to update')
    }

    if (existingStats) {
      await db.update(userStats).set(updateData).where(eq(userStats.userId, userId))
    } else {
      await db.insert(userStats).values({
        id: nanoid(),
        userId,
        ...updateData,
      })
    }

    logger.info(`Admin API: Updated billing for user ${userId}`, {
      updated,
      warnings,
      reason,
      previousValues: existingStats
        ? {
            currentUsageLimit: existingStats.currentUsageLimit,
            billingBlocked: existingStats.billingBlocked,
            currentPeriodCost: existingStats.currentPeriodCost,
          }
        : null,
      newValues: updateData,
      isTeamMember: !!orgMembership,
    })

    return singleResponse({
      success: true,
      updated,
      warnings,
      reason,
    })
  } catch (error) {
    logger.error('Admin API: Failed to update user billing', { error, userId })
    return internalErrorResponse('Failed to update user billing')
  }
})
