/**
 * GET /api/v1/admin/subscriptions/[id]
 *
 * Get subscription details.
 *
 * Response: AdminSingleResponse<AdminSubscription>
 *
 * PATCH /api/v1/admin/subscriptions/[id]
 *
 * Update subscription details with optional side effects.
 *
 * Body:
 *   - plan?: string - New plan (free, pro, team, enterprise)
 *   - status?: string - New status (active, canceled, etc.)
 *   - seats?: number - Seat count (for team plans)
 *   - metadata?: object - Subscription metadata (for enterprise)
 *   - periodStart?: string - Period start (ISO date)
 *   - periodEnd?: string - Period end (ISO date)
 *   - cancelAtPeriodEnd?: boolean - Cancel at period end flag
 *   - syncLimits?: boolean - Sync usage limits for affected users (default: false)
 *   - reason?: string - Reason for the change (for audit logging)
 *
 * Response: AdminSingleResponse<AdminSubscription & { sideEffects }>
 */

import { db } from '@sim/db'
import { member, subscription } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { syncUsageLimitsFromSubscription } from '@/lib/billing/core/usage'
import { createLogger } from '@/lib/logs/console/logger'
import { withAdminAuthParams } from '@/app/api/v1/admin/middleware'
import {
  badRequestResponse,
  internalErrorResponse,
  notFoundResponse,
  singleResponse,
} from '@/app/api/v1/admin/responses'
import { toAdminSubscription } from '@/app/api/v1/admin/types'

const logger = createLogger('AdminSubscriptionDetailAPI')

interface RouteParams {
  id: string
}

const VALID_PLANS = ['free', 'pro', 'team', 'enterprise']
const VALID_STATUSES = ['active', 'canceled', 'past_due', 'unpaid', 'trialing', 'incomplete']

export const GET = withAdminAuthParams<RouteParams>(async (_, context) => {
  const { id: subscriptionId } = await context.params

  try {
    const [subData] = await db
      .select()
      .from(subscription)
      .where(eq(subscription.id, subscriptionId))
      .limit(1)

    if (!subData) {
      return notFoundResponse('Subscription')
    }

    logger.info(`Admin API: Retrieved subscription ${subscriptionId}`)

    return singleResponse(toAdminSubscription(subData))
  } catch (error) {
    logger.error('Admin API: Failed to get subscription', { error, subscriptionId })
    return internalErrorResponse('Failed to get subscription')
  }
})

export const PATCH = withAdminAuthParams<RouteParams>(async (request, context) => {
  const { id: subscriptionId } = await context.params

  try {
    const body = await request.json()
    const syncLimits = body.syncLimits === true
    const reason = body.reason || 'Admin update (no reason provided)'

    const [existing] = await db
      .select()
      .from(subscription)
      .where(eq(subscription.id, subscriptionId))
      .limit(1)

    if (!existing) {
      return notFoundResponse('Subscription')
    }

    const updateData: Record<string, unknown> = {}
    const warnings: string[] = []

    if (body.plan !== undefined) {
      if (!VALID_PLANS.includes(body.plan)) {
        return badRequestResponse(`plan must be one of: ${VALID_PLANS.join(', ')}`)
      }
      if (body.plan !== existing.plan) {
        warnings.push(
          `Plan change from ${existing.plan} to ${body.plan}. This does NOT update Stripe - manual sync required.`
        )
      }
      updateData.plan = body.plan
    }

    if (body.status !== undefined) {
      if (!VALID_STATUSES.includes(body.status)) {
        return badRequestResponse(`status must be one of: ${VALID_STATUSES.join(', ')}`)
      }
      if (body.status !== existing.status) {
        warnings.push(
          `Status change from ${existing.status} to ${body.status}. This does NOT update Stripe - manual sync required.`
        )
      }
      updateData.status = body.status
    }

    if (body.seats !== undefined) {
      if (typeof body.seats !== 'number' || body.seats < 1 || !Number.isInteger(body.seats)) {
        return badRequestResponse('seats must be a positive integer')
      }
      updateData.seats = body.seats
    }

    if (body.metadata !== undefined) {
      if (typeof body.metadata !== 'object' || body.metadata === null) {
        return badRequestResponse('metadata must be an object')
      }
      updateData.metadata = {
        ...((existing.metadata as Record<string, unknown>) || {}),
        ...body.metadata,
      }
    }

    if (body.periodStart !== undefined) {
      const date = new Date(body.periodStart)
      if (Number.isNaN(date.getTime())) {
        return badRequestResponse('periodStart must be a valid ISO date')
      }
      updateData.periodStart = date
    }

    if (body.periodEnd !== undefined) {
      const date = new Date(body.periodEnd)
      if (Number.isNaN(date.getTime())) {
        return badRequestResponse('periodEnd must be a valid ISO date')
      }
      updateData.periodEnd = date
    }

    if (body.cancelAtPeriodEnd !== undefined) {
      if (typeof body.cancelAtPeriodEnd !== 'boolean') {
        return badRequestResponse('cancelAtPeriodEnd must be a boolean')
      }
      updateData.cancelAtPeriodEnd = body.cancelAtPeriodEnd
    }

    if (Object.keys(updateData).length === 0) {
      return badRequestResponse('No valid fields to update')
    }

    const [updated] = await db
      .update(subscription)
      .set(updateData)
      .where(eq(subscription.id, subscriptionId))
      .returning()

    const sideEffects: {
      limitsSynced: boolean
      usersAffected: string[]
      errors: string[]
    } = {
      limitsSynced: false,
      usersAffected: [],
      errors: [],
    }

    if (syncLimits) {
      try {
        const referenceId = updated.referenceId

        if (['free', 'pro'].includes(updated.plan)) {
          await syncUsageLimitsFromSubscription(referenceId)
          sideEffects.usersAffected.push(referenceId)
          sideEffects.limitsSynced = true
        } else if (['team', 'enterprise'].includes(updated.plan)) {
          const members = await db
            .select({ userId: member.userId })
            .from(member)
            .where(eq(member.organizationId, referenceId))

          for (const m of members) {
            try {
              await syncUsageLimitsFromSubscription(m.userId)
              sideEffects.usersAffected.push(m.userId)
            } catch (memberError) {
              sideEffects.errors.push(`Failed to sync limits for user ${m.userId}`)
              logger.error('Admin API: Failed to sync limits for member', {
                userId: m.userId,
                error: memberError,
              })
            }
          }
          sideEffects.limitsSynced = members.length > 0
        }

        logger.info('Admin API: Synced usage limits after subscription update', {
          subscriptionId,
          usersAffected: sideEffects.usersAffected.length,
        })
      } catch (syncError) {
        sideEffects.errors.push('Failed to sync usage limits')
        logger.error('Admin API: Failed to sync usage limits', {
          subscriptionId,
          error: syncError,
        })
      }
    }

    logger.info(`Admin API: Updated subscription ${subscriptionId}`, {
      fields: Object.keys(updateData),
      previousPlan: existing.plan,
      previousStatus: existing.status,
      syncLimits,
      reason,
    })

    return singleResponse({
      ...toAdminSubscription(updated),
      sideEffects,
      warnings,
    })
  } catch (error) {
    logger.error('Admin API: Failed to update subscription', { error, subscriptionId })
    return internalErrorResponse('Failed to update subscription')
  }
})
