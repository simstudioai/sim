import { createLogger } from '@sim/logger'
import {
  createStorageAdapter,
  type RateLimitStorageAdapter,
  type TokenBucketConfig,
} from './storage'
import {
  MANUAL_EXECUTION_LIMIT,
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMITS,
  type RateLimitCounterType,
  type SubscriptionPlan,
  type TriggerType,
} from './types'

const logger = createLogger('RateLimiter')

interface SubscriptionInfo {
  plan: string
  referenceId: string
}

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAt: Date
  retryAfterMs?: number
}

export interface RateLimitStatus {
  requestsPerMinute: number
  maxBurst: number
  remaining: number
  resetAt: Date
}

export class RateLimiter {
  private storage: RateLimitStorageAdapter

  constructor(storage?: RateLimitStorageAdapter) {
    this.storage = storage ?? createStorageAdapter()
  }

  private getRateLimitKey(userId: string, subscription: SubscriptionInfo | null): string {
    if (!subscription) return userId

    const plan = subscription.plan as SubscriptionPlan
    if ((plan === 'team' || plan === 'enterprise') && subscription.referenceId !== userId) {
      return subscription.referenceId
    }

    return userId
  }

  private getCounterType(triggerType: TriggerType, isAsync: boolean): RateLimitCounterType {
    if (triggerType === 'api-endpoint') return 'api-endpoint'
    return isAsync ? 'async' : 'sync'
  }

  private getBucketConfig(
    plan: SubscriptionPlan,
    counterType: RateLimitCounterType
  ): TokenBucketConfig {
    const config = RATE_LIMITS[plan]
    switch (counterType) {
      case 'api-endpoint':
        return config.apiEndpoint
      case 'async':
        return config.async
      case 'sync':
        return config.sync
    }
  }

  private buildStorageKey(rateLimitKey: string, counterType: RateLimitCounterType): string {
    return `${rateLimitKey}:${counterType}`
  }

  private createUnlimitedResult(): RateLimitResult {
    return {
      allowed: true,
      remaining: MANUAL_EXECUTION_LIMIT,
      resetAt: new Date(Date.now() + RATE_LIMIT_WINDOW_MS),
    }
  }

  private createUnlimitedStatus(config: TokenBucketConfig): RateLimitStatus {
    return {
      requestsPerMinute: MANUAL_EXECUTION_LIMIT,
      maxBurst: MANUAL_EXECUTION_LIMIT,
      remaining: MANUAL_EXECUTION_LIMIT,
      resetAt: new Date(Date.now() + config.refillIntervalMs),
    }
  }

  async checkRateLimitWithSubscription(
    userId: string,
    subscription: SubscriptionInfo | null,
    triggerType: TriggerType = 'manual',
    isAsync = false
  ): Promise<RateLimitResult> {
    try {
      if (triggerType === 'manual') {
        return this.createUnlimitedResult()
      }

      const plan = (subscription?.plan || 'free') as SubscriptionPlan
      const rateLimitKey = this.getRateLimitKey(userId, subscription)
      const counterType = this.getCounterType(triggerType, isAsync)
      const config = this.getBucketConfig(plan, counterType)
      const storageKey = this.buildStorageKey(rateLimitKey, counterType)

      const result = await this.storage.consumeTokens(storageKey, 1, config)

      if (!result.allowed) {
        logger.info('Rate limit exceeded', {
          rateLimitKey,
          counterType,
          plan,
          tokensRemaining: result.tokensRemaining,
        })
      }

      return {
        allowed: result.allowed,
        remaining: result.tokensRemaining,
        resetAt: result.resetAt,
        retryAfterMs: result.retryAfterMs,
      }
    } catch (error) {
      logger.error('Rate limit storage error - failing closed (denying request)', {
        error: error instanceof Error ? error.message : String(error),
        userId,
        triggerType,
        isAsync,
      })
      return {
        allowed: false,
        remaining: 0,
        resetAt: new Date(Date.now() + RATE_LIMIT_WINDOW_MS),
        retryAfterMs: RATE_LIMIT_WINDOW_MS,
      }
    }
  }

  async getRateLimitStatusWithSubscription(
    userId: string,
    subscription: SubscriptionInfo | null,
    triggerType: TriggerType = 'manual',
    isAsync = false
  ): Promise<RateLimitStatus> {
    try {
      const plan = (subscription?.plan || 'free') as SubscriptionPlan
      const counterType = this.getCounterType(triggerType, isAsync)
      const config = this.getBucketConfig(plan, counterType)

      if (triggerType === 'manual') {
        return this.createUnlimitedStatus(config)
      }

      const rateLimitKey = this.getRateLimitKey(userId, subscription)
      const storageKey = this.buildStorageKey(rateLimitKey, counterType)

      const status = await this.storage.getTokenStatus(storageKey, config)

      return {
        requestsPerMinute: config.refillRate,
        maxBurst: config.maxTokens,
        remaining: Math.floor(status.tokensAvailable),
        resetAt: status.nextRefillAt,
      }
    } catch (error) {
      logger.error('Error getting rate limit status - returning default config', {
        error: error instanceof Error ? error.message : String(error),
        userId,
        triggerType,
        isAsync,
      })
      const plan = (subscription?.plan || 'free') as SubscriptionPlan
      const counterType = this.getCounterType(triggerType, isAsync)
      const config = this.getBucketConfig(plan, counterType)
      return {
        requestsPerMinute: config.refillRate,
        maxBurst: config.maxTokens,
        remaining: 0,
        resetAt: new Date(Date.now() + RATE_LIMIT_WINDOW_MS),
      }
    }
  }

  async resetRateLimit(rateLimitKey: string): Promise<void> {
    try {
      await Promise.all([
        this.storage.resetBucket(`${rateLimitKey}:sync`),
        this.storage.resetBucket(`${rateLimitKey}:async`),
        this.storage.resetBucket(`${rateLimitKey}:api-endpoint`),
      ])
      logger.info(`Reset rate limit for ${rateLimitKey}`)
    } catch (error) {
      logger.error('Error resetting rate limit:', error)
      throw error
    }
  }
}
