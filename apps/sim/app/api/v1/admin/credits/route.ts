/**
 * POST /api/v1/admin/credits
 *
 * Issue credits to a user by user ID or email.
 *
 * Body:
 *   - userId?: string - The user ID to issue credits to
 *   - email?: string - The user email to issue credits to (alternative to userId)
 *   - amount: number - The amount of credits to issue (in dollars)
 *   - reason?: string - Reason for issuing credits (for audit logging)
 *
 * Response: AdminSingleResponse<{
 *   success: true,
 *   entityType: 'user' | 'organization',
 *   entityId: string,
 *   amount: number,
 *   newCreditBalance: number,
 *   newUsageLimit: number,
 * }>
 *
 * For Pro users: credits are added to user_stats.credit_balance
 * For Team users: credits are added to organization.credit_balance
 * Usage limits are updated accordingly to allow spending the credits.
 */

import { db } from '@sim/db'
import { organization, subscription, user, userStats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { getPlanPricing } from '@/lib/billing/core/billing'
import { getHighestPrioritySubscription } from '@/lib/billing/core/subscription'
import { withAdminAuth } from '@/app/api/v1/admin/middleware'
import {
  badRequestResponse,
  internalErrorResponse,
  notFoundResponse,
  singleResponse,
} from '@/app/api/v1/admin/responses'

const logger = createLogger('AdminCreditsAPI')

export const POST = withAdminAuth(async (request) => {
  try {
    const body = await request.json()
    const { userId, email, amount, reason } = body

    if (!userId && !email) {
      return badRequestResponse('Either userId or email is required')
    }

    if (typeof amount !== 'number' || amount <= 0) {
      return badRequestResponse('amount must be a positive number')
    }

    let resolvedUserId: string
    let userEmail: string | null = null

    if (userId) {
      const [userData] = await db
        .select({ id: user.id, email: user.email })
        .from(user)
        .where(eq(user.id, userId))
        .limit(1)

      if (!userData) {
        return notFoundResponse('User')
      }
      resolvedUserId = userData.id
      userEmail = userData.email
    } else {
      const normalizedEmail = email.toLowerCase().trim()
      const [userData] = await db
        .select({ id: user.id, email: user.email })
        .from(user)
        .where(eq(user.email, normalizedEmail))
        .limit(1)

      if (!userData) {
        return notFoundResponse('User with email')
      }
      resolvedUserId = userData.id
      userEmail = userData.email
    }

    const userSubscription = await getHighestPrioritySubscription(resolvedUserId)

    let entityType: 'user' | 'organization'
    let entityId: string
    let plan: string
    let seats: number | null = null

    if (userSubscription?.plan === 'team' || userSubscription?.plan === 'enterprise') {
      entityType = 'organization'
      entityId = userSubscription.referenceId
      plan = userSubscription.plan

      const [orgExists] = await db
        .select({ id: organization.id })
        .from(organization)
        .where(eq(organization.id, entityId))
        .limit(1)

      if (!orgExists) {
        return notFoundResponse('Organization')
      }

      const [subData] = await db
        .select({ seats: subscription.seats })
        .from(subscription)
        .where(and(eq(subscription.referenceId, entityId), eq(subscription.status, 'active')))
        .limit(1)

      seats = subData?.seats ?? null
    } else if (userSubscription?.plan === 'pro') {
      entityType = 'user'
      entityId = resolvedUserId
      plan = 'pro'
    } else {
      return badRequestResponse(
        'User must have an active Pro or Team subscription to receive credits'
      )
    }

    const { basePrice } = getPlanPricing(plan)

    const result = await db.transaction(async (tx) => {
      let newCreditBalance: number
      let newUsageLimit: number

      if (entityType === 'organization') {
        await tx
          .update(organization)
          .set({ creditBalance: sql`${organization.creditBalance} + ${amount}` })
          .where(eq(organization.id, entityId))

        const [orgData] = await tx
          .select({
            creditBalance: organization.creditBalance,
            orgUsageLimit: organization.orgUsageLimit,
          })
          .from(organization)
          .where(eq(organization.id, entityId))
          .limit(1)

        newCreditBalance = Number.parseFloat(orgData?.creditBalance || '0')
        const currentLimit = Number.parseFloat(orgData?.orgUsageLimit || '0')
        const planBase = Number(basePrice) * (seats || 1)
        const calculatedLimit = planBase + newCreditBalance

        if (calculatedLimit > currentLimit) {
          await tx
            .update(organization)
            .set({ orgUsageLimit: calculatedLimit.toString() })
            .where(eq(organization.id, entityId))
          newUsageLimit = calculatedLimit
        } else {
          newUsageLimit = currentLimit
        }
      } else {
        const [existingStats] = await tx
          .select({ id: userStats.id })
          .from(userStats)
          .where(eq(userStats.userId, entityId))
          .limit(1)

        if (!existingStats) {
          await tx.insert(userStats).values({
            id: nanoid(),
            userId: entityId,
            creditBalance: amount.toString(),
          })
        } else {
          await tx
            .update(userStats)
            .set({ creditBalance: sql`${userStats.creditBalance} + ${amount}` })
            .where(eq(userStats.userId, entityId))
        }

        const [stats] = await tx
          .select({
            creditBalance: userStats.creditBalance,
            currentUsageLimit: userStats.currentUsageLimit,
          })
          .from(userStats)
          .where(eq(userStats.userId, entityId))
          .limit(1)

        newCreditBalance = Number.parseFloat(stats?.creditBalance || '0')
        const currentLimit = Number.parseFloat(stats?.currentUsageLimit || '0')
        const planBase = Number(basePrice)
        const calculatedLimit = planBase + newCreditBalance

        if (calculatedLimit > currentLimit) {
          await tx
            .update(userStats)
            .set({ currentUsageLimit: calculatedLimit.toString() })
            .where(eq(userStats.userId, entityId))
          newUsageLimit = calculatedLimit
        } else {
          newUsageLimit = currentLimit
        }
      }

      return { newCreditBalance, newUsageLimit }
    })

    const { newCreditBalance, newUsageLimit } = result

    logger.info('Admin API: Issued credits', {
      resolvedUserId,
      userEmail,
      entityType,
      entityId,
      amount,
      newCreditBalance,
      newUsageLimit,
      reason: reason || 'No reason provided',
    })

    return singleResponse({
      success: true,
      userId: resolvedUserId,
      userEmail,
      entityType,
      entityId,
      amount,
      newCreditBalance,
      newUsageLimit,
    })
  } catch (error) {
    logger.error('Admin API: Failed to issue credits', { error })
    return internalErrorResponse('Failed to issue credits')
  }
})
