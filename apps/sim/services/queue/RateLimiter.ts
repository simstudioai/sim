import { db } from '@sim/db'
import { userRateLimits } from '@sim/db/schema'
import { eq, sql } from 'drizzle-orm'
import { getHighestPrioritySubscription } from '@/lib/billing/core/subscription'
import { createLogger } from '@/lib/logs/console/logger'
import {
  MANUAL_EXECUTION_LIMIT,
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMITS,
  type RateLimitCounterType,
  type SubscriptionPlan,
  type TriggerType,
} from '@/services/queue/types'

const logger = createLogger('RateLimiter')

interface SubscriptionInfo {
  plan: string
  referenceId: string
}

export class RateLimiter {
  /**
   * Determine the rate limit key based on subscription
   * For team/enterprise plans via organization, use the organization ID
   * For direct user subscriptions (including direct team), use the user ID
   */
  private getRateLimitKey(userId: string, subscription: SubscriptionInfo | null): string {
    if (!subscription) {
      return userId
    }

    const plan = subscription.plan as SubscriptionPlan

    // Check if this is an organization subscription (referenceId !== userId)
    // If referenceId === userId, it's a direct user subscription
    if ((plan === 'team' || plan === 'enterprise') && subscription.referenceId !== userId) {
      // This is an organization subscription
      // All organization members share the same rate limit pool
      return subscription.referenceId
    }

    // For direct user subscriptions (free/pro/team/enterprise where referenceId === userId)
    return userId
  }

  /**
   * Determine which counter type to use based on trigger type and async flag
   */
  private getCounterType(triggerType: TriggerType, isAsync: boolean): RateLimitCounterType {
    if (triggerType === 'api-endpoint') {
      return 'api-endpoint'
    }
    return isAsync ? 'async' : 'sync'
  }

  /**
   * Get the rate limit for a specific counter type
   */
  private getRateLimitForCounter(
    config: (typeof RATE_LIMITS)[SubscriptionPlan],
    counterType: RateLimitCounterType
  ): number {
    switch (counterType) {
      case 'api-endpoint':
        return config.apiEndpointRequestsPerMinute
      case 'async':
        return config.asyncApiExecutionsPerMinute
      case 'sync':
        return config.syncApiExecutionsPerMinute
    }
  }

  /**
   * Get the current count from a rate limit record for a specific counter type
   */
  private getCountFromRecord(
    record: { syncApiRequests: number; asyncApiRequests: number; apiEndpointRequests: number },
    counterType: RateLimitCounterType
  ): number {
    switch (counterType) {
      case 'api-endpoint':
        return record.apiEndpointRequests
      case 'async':
        return record.asyncApiRequests
      case 'sync':
        return record.syncApiRequests
    }
  }

  /**
   * Check if user can execute a workflow with organization-aware rate limiting
   * Manual executions bypass rate limiting entirely
   */
  async checkRateLimitWithSubscription(
    userId: string,
    subscription: SubscriptionInfo | null,
    triggerType: TriggerType = 'manual',
    isAsync = false
  ): Promise<{ allowed: boolean; remaining: number; resetAt: Date }> {
    try {
      if (triggerType === 'manual') {
        return {
          allowed: true,
          remaining: MANUAL_EXECUTION_LIMIT,
          resetAt: new Date(Date.now() + RATE_LIMIT_WINDOW_MS),
        }
      }

      const subscriptionPlan = (subscription?.plan || 'free') as SubscriptionPlan
      const rateLimitKey = this.getRateLimitKey(userId, subscription)
      const limit = RATE_LIMITS[subscriptionPlan]

      const counterType = this.getCounterType(triggerType, isAsync)
      const execLimit = this.getRateLimitForCounter(limit, counterType)

      const now = new Date()
      const windowStart = new Date(now.getTime() - RATE_LIMIT_WINDOW_MS)

      // Get or create rate limit record using the rate limit key
      const [rateLimitRecord] = await db
        .select()
        .from(userRateLimits)
        .where(eq(userRateLimits.referenceId, rateLimitKey))
        .limit(1)

      if (!rateLimitRecord || new Date(rateLimitRecord.windowStart) < windowStart) {
        // Window expired - reset window with this request as the first one
        const result = await db
          .insert(userRateLimits)
          .values({
            referenceId: rateLimitKey,
            syncApiRequests: counterType === 'sync' ? 1 : 0,
            asyncApiRequests: counterType === 'async' ? 1 : 0,
            apiEndpointRequests: counterType === 'api-endpoint' ? 1 : 0,
            windowStart: now,
            lastRequestAt: now,
            isRateLimited: false,
          })
          .onConflictDoUpdate({
            target: userRateLimits.referenceId,
            set: {
              // Only reset if window is still expired (avoid race condition)
              syncApiRequests: sql`CASE WHEN ${userRateLimits.windowStart} < ${windowStart.toISOString()} THEN ${counterType === 'sync' ? 1 : 0} ELSE ${userRateLimits.syncApiRequests} + ${counterType === 'sync' ? 1 : 0} END`,
              asyncApiRequests: sql`CASE WHEN ${userRateLimits.windowStart} < ${windowStart.toISOString()} THEN ${counterType === 'async' ? 1 : 0} ELSE ${userRateLimits.asyncApiRequests} + ${counterType === 'async' ? 1 : 0} END`,
              apiEndpointRequests: sql`CASE WHEN ${userRateLimits.windowStart} < ${windowStart.toISOString()} THEN ${counterType === 'api-endpoint' ? 1 : 0} ELSE ${userRateLimits.apiEndpointRequests} + ${counterType === 'api-endpoint' ? 1 : 0} END`,
              windowStart: sql`CASE WHEN ${userRateLimits.windowStart} < ${windowStart.toISOString()} THEN ${now.toISOString()} ELSE ${userRateLimits.windowStart} END`,
              lastRequestAt: now,
              isRateLimited: false,
              rateLimitResetAt: null,
            },
          })
          .returning({
            syncApiRequests: userRateLimits.syncApiRequests,
            asyncApiRequests: userRateLimits.asyncApiRequests,
            apiEndpointRequests: userRateLimits.apiEndpointRequests,
            windowStart: userRateLimits.windowStart,
          })

        const insertedRecord = result[0]
        const actualCount = this.getCountFromRecord(insertedRecord, counterType)

        // Check if we exceeded the limit
        if (actualCount > execLimit) {
          const resetAt = new Date(
            new Date(insertedRecord.windowStart).getTime() + RATE_LIMIT_WINDOW_MS
          )

          await db
            .update(userRateLimits)
            .set({
              isRateLimited: true,
              rateLimitResetAt: resetAt,
            })
            .where(eq(userRateLimits.referenceId, rateLimitKey))

          logger.info(
            `Rate limit exceeded - request ${actualCount} > limit ${execLimit} for ${
              rateLimitKey === userId ? `user ${userId}` : `organization ${rateLimitKey}`
            }`,
            {
              execLimit,
              isAsync,
              actualCount,
              rateLimitKey,
              plan: subscriptionPlan,
            }
          )

          return {
            allowed: false,
            remaining: 0,
            resetAt,
          }
        }

        return {
          allowed: true,
          remaining: execLimit - actualCount,
          resetAt: new Date(new Date(insertedRecord.windowStart).getTime() + RATE_LIMIT_WINDOW_MS),
        }
      }

      // Simple atomic increment - increment first, then check if over limit
      const updateResult = await db
        .update(userRateLimits)
        .set({
          ...(counterType === 'api-endpoint'
            ? { apiEndpointRequests: sql`${userRateLimits.apiEndpointRequests} + 1` }
            : counterType === 'async'
              ? { asyncApiRequests: sql`${userRateLimits.asyncApiRequests} + 1` }
              : { syncApiRequests: sql`${userRateLimits.syncApiRequests} + 1` }),
          lastRequestAt: now,
        })
        .where(eq(userRateLimits.referenceId, rateLimitKey))
        .returning({
          asyncApiRequests: userRateLimits.asyncApiRequests,
          syncApiRequests: userRateLimits.syncApiRequests,
          apiEndpointRequests: userRateLimits.apiEndpointRequests,
        })

      const updatedRecord = updateResult[0]
      const actualNewRequests = this.getCountFromRecord(updatedRecord, counterType)

      // Check if we exceeded the limit AFTER the atomic increment
      if (actualNewRequests > execLimit) {
        const resetAt = new Date(
          new Date(rateLimitRecord.windowStart).getTime() + RATE_LIMIT_WINDOW_MS
        )

        logger.info(
          `Rate limit exceeded - request ${actualNewRequests} > limit ${execLimit} for ${
            rateLimitKey === userId ? `user ${userId}` : `organization ${rateLimitKey}`
          }`,
          {
            execLimit,
            isAsync,
            actualNewRequests,
            rateLimitKey,
            plan: subscriptionPlan,
          }
        )

        // Update rate limited status
        await db
          .update(userRateLimits)
          .set({
            isRateLimited: true,
            rateLimitResetAt: resetAt,
          })
          .where(eq(userRateLimits.referenceId, rateLimitKey))

        return {
          allowed: false,
          remaining: 0,
          resetAt,
        }
      }

      return {
        allowed: true,
        remaining: execLimit - actualNewRequests,
        resetAt: new Date(new Date(rateLimitRecord.windowStart).getTime() + RATE_LIMIT_WINDOW_MS),
      }
    } catch (error) {
      logger.error('Error checking rate limit:', error)
      // Allow execution on error to avoid blocking users
      return {
        allowed: true,
        remaining: 0,
        resetAt: new Date(Date.now() + RATE_LIMIT_WINDOW_MS),
      }
    }
  }

  /**
   * Legacy method - for backward compatibility
   * @deprecated Use checkRateLimitWithSubscription instead
   */
  async checkRateLimit(
    userId: string,
    subscriptionPlan: SubscriptionPlan = 'free',
    triggerType: TriggerType = 'manual',
    isAsync = false
  ): Promise<{ allowed: boolean; remaining: number; resetAt: Date }> {
    // For backward compatibility, fetch the subscription
    const subscription = await getHighestPrioritySubscription(userId)
    return this.checkRateLimitWithSubscription(userId, subscription, triggerType, isAsync)
  }

  /**
   * Get current rate limit status with organization awareness
   * Only applies to API executions
   */
  async getRateLimitStatusWithSubscription(
    userId: string,
    subscription: SubscriptionInfo | null,
    triggerType: TriggerType = 'manual',
    isAsync = false
  ): Promise<{ used: number; limit: number; remaining: number; resetAt: Date }> {
    try {
      if (triggerType === 'manual') {
        return {
          used: 0,
          limit: MANUAL_EXECUTION_LIMIT,
          remaining: MANUAL_EXECUTION_LIMIT,
          resetAt: new Date(Date.now() + RATE_LIMIT_WINDOW_MS),
        }
      }

      const subscriptionPlan = (subscription?.plan || 'free') as SubscriptionPlan
      const rateLimitKey = this.getRateLimitKey(userId, subscription)
      const limit = RATE_LIMITS[subscriptionPlan]

      const counterType = this.getCounterType(triggerType, isAsync)
      const execLimit = this.getRateLimitForCounter(limit, counterType)

      const now = new Date()
      const windowStart = new Date(now.getTime() - RATE_LIMIT_WINDOW_MS)

      const [rateLimitRecord] = await db
        .select()
        .from(userRateLimits)
        .where(eq(userRateLimits.referenceId, rateLimitKey))
        .limit(1)

      if (!rateLimitRecord || new Date(rateLimitRecord.windowStart) < windowStart) {
        return {
          used: 0,
          limit: execLimit,
          remaining: execLimit,
          resetAt: new Date(now.getTime() + RATE_LIMIT_WINDOW_MS),
        }
      }

      const used = this.getCountFromRecord(rateLimitRecord, counterType)
      return {
        used,
        limit: execLimit,
        remaining: Math.max(0, execLimit - used),
        resetAt: new Date(new Date(rateLimitRecord.windowStart).getTime() + RATE_LIMIT_WINDOW_MS),
      }
    } catch (error) {
      logger.error('Error getting rate limit status:', error)
      const execLimit = isAsync
        ? RATE_LIMITS[(subscription?.plan || 'free') as SubscriptionPlan]
            .asyncApiExecutionsPerMinute
        : RATE_LIMITS[(subscription?.plan || 'free') as SubscriptionPlan].syncApiExecutionsPerMinute
      return {
        used: 0,
        limit: execLimit,
        remaining: execLimit,
        resetAt: new Date(Date.now() + RATE_LIMIT_WINDOW_MS),
      }
    }
  }

  /**
   * Legacy method - for backward compatibility
   * @deprecated Use getRateLimitStatusWithSubscription instead
   */
  async getRateLimitStatus(
    userId: string,
    subscriptionPlan: SubscriptionPlan = 'free',
    triggerType: TriggerType = 'manual',
    isAsync = false
  ): Promise<{ used: number; limit: number; remaining: number; resetAt: Date }> {
    // For backward compatibility, fetch the subscription
    const subscription = await getHighestPrioritySubscription(userId)
    return this.getRateLimitStatusWithSubscription(userId, subscription, triggerType, isAsync)
  }

  /**
   * Reset rate limit for a user or organization
   */
  async resetRateLimit(rateLimitKey: string): Promise<void> {
    try {
      await db.delete(userRateLimits).where(eq(userRateLimits.referenceId, rateLimitKey))
      logger.info(`Reset rate limit for ${rateLimitKey}`)
    } catch (error) {
      logger.error('Error resetting rate limit:', error)
      throw error
    }
  }
}
