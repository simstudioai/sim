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
 *   - reason?: string - Reason for the change (for audit logging)
 *
 * Response: AdminSingleResponse<{ success: true, updated: string[], warnings: string[] }>
 */

import { db } from '@sim/db'
import {
  member,
  organization,
  subscription,
  user,
  userStats,
  workflow,
  workflowExecutionLogs,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateShortId } from '@sim/utils/id'
import { eq, or, sql } from 'drizzle-orm'
import {
  adminV1GetUserBillingContract,
  adminV1UpdateUserBillingContract,
} from '@/lib/api/contracts/v1/admin'
import { parseRequest } from '@/lib/api/server'
import { getHighestPrioritySubscription } from '@/lib/billing/core/subscription'
import {
  calculateAllTimeUsageActivityForUser,
  calculateCurrentLedgerUsageForUser,
} from '@/lib/billing/ledger/usage-ledger'
import { isOrgScopedSubscription } from '@/lib/billing/subscriptions/utils'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { withAdminAuthParams } from '@/app/api/v1/admin/middleware'
import {
  adminInvalidJsonResponse,
  adminValidationErrorResponse,
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

export const GET = withRouteHandler(
  withAdminAuthParams<RouteParams>(async (request, context) => {
    const parsed = await parseRequest(adminV1GetUserBillingContract, request, context, {
      validationErrorResponse: adminValidationErrorResponse,
    })
    if (!parsed.success) return parsed.response

    const { id: userId } = parsed.data.params

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
      const highestSubscription = await getHighestPrioritySubscription(userId)
      const [executionCounts] = await db
        .select({
          manual: sql<number>`COUNT(*) FILTER (WHERE ${workflowExecutionLogs.trigger} = 'manual')::int`,
          api: sql<number>`COUNT(*) FILTER (WHERE ${workflowExecutionLogs.trigger} = 'api')::int`,
          webhook: sql<number>`COUNT(*) FILTER (WHERE ${workflowExecutionLogs.trigger} = 'webhook')::int`,
          schedule: sql<number>`COUNT(*) FILTER (WHERE ${workflowExecutionLogs.trigger} = 'schedule')::int`,
          chat: sql<number>`COUNT(*) FILTER (WHERE ${workflowExecutionLogs.trigger} = 'chat')::int`,
          mcp: sql<number>`COUNT(*) FILTER (WHERE ${workflowExecutionLogs.trigger} = 'mcp')::int`,
          a2a: sql<number>`COUNT(*) FILTER (WHERE ${workflowExecutionLogs.trigger} = 'a2a')::int`,
        })
        .from(workflowExecutionLogs)
        .innerJoin(workflow, eq(workflowExecutionLogs.workflowId, workflow.id))
        .where(eq(workflow.userId, userId))
      const currentPeriod =
        highestSubscription?.periodStart && highestSubscription.periodEnd
          ? {
              periodStart: highestSubscription.periodStart,
              periodEnd: highestSubscription.periodEnd,
            }
          : undefined
      const [currentActivity, allTimeLedgerUsage] = await Promise.all([
        calculateAllTimeUsageActivityForUser(userId, db, currentPeriod),
        calculateAllTimeUsageActivityForUser(userId),
      ])
      const currentCopilotCost =
        (currentActivity.sourceTotals.copilot ?? 0) +
        (currentActivity.sourceTotals.mcp_copilot ?? 0)
      const totalCopilotCost =
        (allTimeLedgerUsage.sourceTotals.copilot ?? 0) +
        (allTimeLedgerUsage.sourceTotals.mcp_copilot ?? 0)
      let lastPeriodCost = stats?.lastPeriodCost ?? null
      let lastPeriodCopilotCost = stats?.lastPeriodCopilotCost ?? null
      if (highestSubscription?.periodStart && highestSubscription.periodEnd) {
        const periodMs =
          highestSubscription.periodEnd.getTime() - highestSubscription.periodStart.getTime()
        if (periodMs > 0) {
          const lastPeriodUsage = await calculateAllTimeUsageActivityForUser(userId, db, {
            periodStart: new Date(highestSubscription.periodStart.getTime() - periodMs),
            periodEnd: highestSubscription.periodStart,
          })
          lastPeriodCost = lastPeriodUsage.grossUsage.toString()
          lastPeriodCopilotCost = (
            (lastPeriodUsage.sourceTotals.copilot ?? 0) +
            (lastPeriodUsage.sourceTotals.mcp_copilot ?? 0)
          ).toString()
        }
      }

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
        totalManualExecutions: Number(executionCounts?.manual ?? 0),
        totalApiCalls: Number(executionCounts?.api ?? 0),
        totalWebhookTriggers: Number(executionCounts?.webhook ?? 0),
        totalScheduledExecutions: Number(executionCounts?.schedule ?? 0),
        totalChatExecutions: Number(executionCounts?.chat ?? 0),
        totalMcpExecutions: Number(executionCounts?.mcp ?? 0),
        totalA2aExecutions: Number(executionCounts?.a2a ?? 0),
        totalTokensUsed: allTimeLedgerUsage.totalTokens,
        totalCost: allTimeLedgerUsage.grossUsage.toString(),
        currentUsageLimit: stats?.currentUsageLimit ?? null,
        currentPeriodCost: currentActivity.grossUsage.toString(),
        lastPeriodCost,
        billedOverageThisPeriod: stats?.billedOverageThisPeriod ?? '0',
        storageUsedBytes: stats?.storageUsedBytes ?? 0,
        lastActive: stats?.lastActive?.toISOString() ?? null,
        billingBlocked: stats?.billingBlocked ?? false,
        totalCopilotCost: totalCopilotCost.toString(),
        currentPeriodCopilotCost: currentCopilotCost.toString(),
        lastPeriodCopilotCost,
        totalCopilotTokens: allTimeLedgerUsage.copilotTokens,
        totalCopilotCalls: allTimeLedgerUsage.copilotCalls,
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
)

export const PATCH = withRouteHandler(
  withAdminAuthParams<RouteParams>(async (request, context) => {
    const parsed = await parseRequest(adminV1UpdateUserBillingContract, request, context, {
      validationErrorResponse: adminValidationErrorResponse,
      invalidJsonResponse: adminInvalidJsonResponse,
    })
    if (!parsed.success) return parsed.response

    const { id: userId } = parsed.data.params

    try {
      const {
        currentUsageLimit,
        billingBlocked,
        currentPeriodCost,
        reason: providedReason,
      } = parsed.data.body
      const reason = providedReason || 'Admin update (no reason provided)'

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
      const isOrgScopedMember = isOrgScopedSubscription(userSubscription, userId)

      const [orgMembership] = await db
        .select({ organizationId: member.organizationId })
        .from(member)
        .where(eq(member.userId, userId))
        .limit(1)

      const updateData: Record<string, unknown> = {}
      const updated: string[] = []
      const warnings: string[] = []

      if (currentUsageLimit !== undefined) {
        if (isOrgScopedMember && orgMembership) {
          warnings.push(
            'User is on an org-scoped subscription. Individual limits are ignored in favor of organization limits.'
          )
        }

        if (currentUsageLimit === null) {
          updateData.currentUsageLimit = null
        } else {
          const ledgerUsage = await calculateCurrentLedgerUsageForUser(userId, userSubscription)
          const currentCost = ledgerUsage.effectiveUsage
          if (currentUsageLimit < currentCost) {
            warnings.push(
              `New limit ($${currentUsageLimit.toFixed(2)}) is below current usage ($${currentCost.toFixed(2)}). User may be immediately blocked.`
            )
          }
          updateData.currentUsageLimit = currentUsageLimit.toFixed(2)
        }
        updateData.usageLimitUpdatedAt = new Date()
        updated.push('currentUsageLimit')
      }

      if (billingBlocked !== undefined) {
        if (billingBlocked === false && existingStats?.billingBlocked === true) {
          warnings.push(
            'Unblocking user. Ensure payment issues are resolved to prevent re-blocking on next invoice.'
          )
        }

        updateData.billingBlocked = billingBlocked
        // Clear the reason when unblocking
        if (billingBlocked === false) {
          updateData.billingBlockedReason = null
        }
        updated.push('billingBlocked')
      }

      if (currentPeriodCost !== undefined) {
        warnings.push(
          'currentPeriodCost is derived from usage logs and is ignored for compatibility.'
        )
      }

      if (updated.length === 0) {
        if (currentPeriodCost !== undefined) {
          return singleResponse({
            success: true,
            updated,
            warnings,
            reason,
          })
        }
        return badRequestResponse('No valid fields to update')
      }

      if (existingStats) {
        await db.update(userStats).set(updateData).where(eq(userStats.userId, userId))
      } else {
        await db.insert(userStats).values({
          id: generateShortId(),
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
)
