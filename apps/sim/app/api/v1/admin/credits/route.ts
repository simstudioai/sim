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
import { and, eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { getHighestPrioritySubscription } from '@/lib/billing/core/subscription'
import { addCredits } from '@/lib/billing/credits/balance'
import { setUsageLimitForCredits } from '@/lib/billing/credits/purchase'
import { getEffectiveSeats } from '@/lib/billing/subscriptions/utils'
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

    if (userId && typeof userId !== 'string') {
      return badRequestResponse('userId must be a string')
    }

    if (email && typeof email !== 'string') {
      return badRequestResponse('email must be a string')
    }

    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
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

    if (!userSubscription || !['pro', 'team', 'enterprise'].includes(userSubscription.plan)) {
      return badRequestResponse(
        'User must have an active Pro, Team, or Enterprise subscription to receive credits'
      )
    }

    let entityType: 'user' | 'organization'
    let entityId: string
    const plan = userSubscription.plan
    let seats: number | null = null

    if (plan === 'team' || plan === 'enterprise') {
      entityType = 'organization'
      entityId = userSubscription.referenceId

      const [orgExists] = await db
        .select({ id: organization.id })
        .from(organization)
        .where(eq(organization.id, entityId))
        .limit(1)

      if (!orgExists) {
        return notFoundResponse('Organization')
      }

      const [subData] = await db
        .select()
        .from(subscription)
        .where(and(eq(subscription.referenceId, entityId), eq(subscription.status, 'active')))
        .limit(1)

      seats = getEffectiveSeats(subData)
    } else {
      entityType = 'user'
      entityId = resolvedUserId

      const [existingStats] = await db
        .select({ id: userStats.id })
        .from(userStats)
        .where(eq(userStats.userId, entityId))
        .limit(1)

      if (!existingStats) {
        await db.insert(userStats).values({
          id: nanoid(),
          userId: entityId,
        })
      }
    }

    await addCredits(entityType, entityId, amount)

    let newCreditBalance: number
    if (entityType === 'organization') {
      const [orgData] = await db
        .select({ creditBalance: organization.creditBalance })
        .from(organization)
        .where(eq(organization.id, entityId))
        .limit(1)
      newCreditBalance = Number.parseFloat(orgData?.creditBalance || '0')
    } else {
      const [stats] = await db
        .select({ creditBalance: userStats.creditBalance })
        .from(userStats)
        .where(eq(userStats.userId, entityId))
        .limit(1)
      newCreditBalance = Number.parseFloat(stats?.creditBalance || '0')
    }

    await setUsageLimitForCredits(entityType, entityId, plan, seats, newCreditBalance)

    let newUsageLimit: number
    if (entityType === 'organization') {
      const [orgData] = await db
        .select({ orgUsageLimit: organization.orgUsageLimit })
        .from(organization)
        .where(eq(organization.id, entityId))
        .limit(1)
      newUsageLimit = Number.parseFloat(orgData?.orgUsageLimit || '0')
    } else {
      const [stats] = await db
        .select({ currentUsageLimit: userStats.currentUsageLimit })
        .from(userStats)
        .where(eq(userStats.userId, entityId))
        .limit(1)
      newUsageLimit = Number.parseFloat(stats?.currentUsageLimit || '0')
    }

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
