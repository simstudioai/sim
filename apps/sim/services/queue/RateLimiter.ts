import { eq, sql } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console/logger'
import { db } from '@/db'
import { userRateLimits } from '@/db/schema'
import { RATE_LIMITS, type SubscriptionPlan, type TriggerType } from './types'

const logger = createLogger('RateLimiter')

export class RateLimiter {
  /**
   * Check if user can execute a workflow
   * Manual executions bypass rate limiting entirely
   */
  async checkRateLimit(
    userId: string,
    subscriptionPlan: SubscriptionPlan = 'free',
    triggerType: TriggerType = 'manual',
    isAsync = false
  ): Promise<{ allowed: boolean; remaining: number; resetAt: Date }> {
    try {
      if (triggerType === 'manual') {
        return {
          allowed: true,
          remaining: 999999,
          resetAt: new Date(Date.now() + 60000),
        }
      }

      const limit = RATE_LIMITS[subscriptionPlan]
      const execLimit = isAsync
        ? limit.asyncApiExecutionsPerMinute
        : limit.syncApiExecutionsPerMinute

      const now = new Date()
      const windowStart = new Date(now.getTime() - 60000) // 1 minute ago

      // Get or create rate limit record
      const [rateLimitRecord] = await db
        .select()
        .from(userRateLimits)
        .where(eq(userRateLimits.userId, userId))
        .limit(1)

      if (!rateLimitRecord || new Date(rateLimitRecord.windowStart) < windowStart) {
        // Window expired - reset window with this request as the first one
        const result = await db
          .insert(userRateLimits)
          .values({
            userId,
            syncApiRequests: isAsync ? 0 : 1,
            asyncApiRequests: isAsync ? 1 : 0,
            windowStart: now,
            lastRequestAt: now,
            isRateLimited: false,
          })
          .onConflictDoUpdate({
            target: userRateLimits.userId,
            set: {
              // Only reset if window is still expired (avoid race condition)
              syncApiRequests: sql`CASE WHEN ${userRateLimits.windowStart} < ${windowStart.toISOString()} THEN ${isAsync ? 0 : 1} ELSE ${userRateLimits.syncApiRequests} + ${isAsync ? 0 : 1} END`,
              asyncApiRequests: sql`CASE WHEN ${userRateLimits.windowStart} < ${windowStart.toISOString()} THEN ${isAsync ? 1 : 0} ELSE ${userRateLimits.asyncApiRequests} + ${isAsync ? 1 : 0} END`,
              windowStart: sql`CASE WHEN ${userRateLimits.windowStart} < ${windowStart.toISOString()} THEN ${now.toISOString()} ELSE ${userRateLimits.windowStart} END`,
              lastRequestAt: now,
              isRateLimited: false,
              rateLimitResetAt: null,
            },
          })
          .returning({
            syncApiRequests: userRateLimits.syncApiRequests,
            asyncApiRequests: userRateLimits.asyncApiRequests,
            windowStart: userRateLimits.windowStart,
          })

        const insertedRecord = result[0]
        const actualCount = isAsync
          ? insertedRecord.asyncApiRequests
          : insertedRecord.syncApiRequests

        // Check if we exceeded the limit
        if (actualCount > execLimit) {
          const resetAt = new Date(new Date(insertedRecord.windowStart).getTime() + 60000)

          await db
            .update(userRateLimits)
            .set({
              isRateLimited: true,
              rateLimitResetAt: resetAt,
            })
            .where(eq(userRateLimits.userId, userId))

          return {
            allowed: false,
            remaining: 0,
            resetAt,
          }
        }

        return {
          allowed: true,
          remaining: execLimit - actualCount,
          resetAt: new Date(new Date(insertedRecord.windowStart).getTime() + 60000),
        }
      }

      // Simple atomic increment - increment first, then check if over limit
      const updateResult = await db
        .update(userRateLimits)
        .set({
          ...(isAsync
            ? { asyncApiRequests: sql`${userRateLimits.asyncApiRequests} + 1` }
            : { syncApiRequests: sql`${userRateLimits.syncApiRequests} + 1` }),
          lastRequestAt: now,
        })
        .where(eq(userRateLimits.userId, userId))
        .returning({
          asyncApiRequests: userRateLimits.asyncApiRequests,
          syncApiRequests: userRateLimits.syncApiRequests,
        })

      const updatedRecord = updateResult[0]
      const actualNewRequests = isAsync
        ? updatedRecord.asyncApiRequests
        : updatedRecord.syncApiRequests

      // Check if we exceeded the limit AFTER the atomic increment
      if (actualNewRequests > execLimit) {
        const resetAt = new Date(new Date(rateLimitRecord.windowStart).getTime() + 60000)

        logger.info(
          `Rate limit exceeded - request ${actualNewRequests} > limit ${execLimit} for user ${userId}`,
          {
            execLimit,
            isAsync,
            actualNewRequests,
          }
        )

        // Update rate limited status
        await db
          .update(userRateLimits)
          .set({
            isRateLimited: true,
            rateLimitResetAt: resetAt,
          })
          .where(eq(userRateLimits.userId, userId))

        return {
          allowed: false,
          remaining: 0,
          resetAt,
        }
      }

      return {
        allowed: true,
        remaining: execLimit - actualNewRequests,
        resetAt: new Date(new Date(rateLimitRecord.windowStart).getTime() + 60000),
      }
    } catch (error) {
      logger.error('Error checking rate limit:', error)
      // Allow execution on error to avoid blocking users
      return {
        allowed: true,
        remaining: 0,
        resetAt: new Date(Date.now() + 60000),
      }
    }
  }

  /**
   * Get current rate limit status for user
   * Only applies to API executions
   */
  async getRateLimitStatus(
    userId: string,
    subscriptionPlan: SubscriptionPlan = 'free',
    triggerType: TriggerType = 'manual',
    isAsync = false
  ): Promise<{ used: number; limit: number; remaining: number; resetAt: Date }> {
    try {
      if (triggerType === 'manual') {
        return {
          used: 0,
          limit: 999999,
          remaining: 999999,
          resetAt: new Date(Date.now() + 60000),
        }
      }

      const limit = RATE_LIMITS[subscriptionPlan]
      const execLimit = isAsync
        ? limit.asyncApiExecutionsPerMinute
        : limit.syncApiExecutionsPerMinute
      const now = new Date()
      const windowStart = new Date(now.getTime() - 60000)

      const [rateLimitRecord] = await db
        .select()
        .from(userRateLimits)
        .where(eq(userRateLimits.userId, userId))
        .limit(1)

      if (!rateLimitRecord || new Date(rateLimitRecord.windowStart) < windowStart) {
        return {
          used: 0,
          limit: execLimit,
          remaining: execLimit,
          resetAt: new Date(now.getTime() + 60000),
        }
      }

      const used = isAsync ? rateLimitRecord.asyncApiRequests : rateLimitRecord.syncApiRequests
      return {
        used,
        limit: execLimit,
        remaining: Math.max(0, execLimit - used),
        resetAt: new Date(new Date(rateLimitRecord.windowStart).getTime() + 60000),
      }
    } catch (error) {
      logger.error('Error getting rate limit status:', error)
      const execLimit = isAsync
        ? RATE_LIMITS[subscriptionPlan].asyncApiExecutionsPerMinute
        : RATE_LIMITS[subscriptionPlan].syncApiExecutionsPerMinute
      return {
        used: 0,
        limit: execLimit,
        remaining: execLimit,
        resetAt: new Date(Date.now() + 60000),
      }
    }
  }

  /**
   * Reset rate limit for user (admin action)
   */
  async resetRateLimit(userId: string): Promise<void> {
    try {
      await db.delete(userRateLimits).where(eq(userRateLimits.userId, userId))

      logger.info(`Reset rate limit for user ${userId}`)
    } catch (error) {
      logger.error('Error resetting rate limit:', error)
      throw error
    }
  }
}
