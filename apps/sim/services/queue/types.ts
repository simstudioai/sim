import type { InferSelectModel } from 'drizzle-orm'
import type { userRateLimits } from '@/db/schema'

// Database types
export type UserRateLimit = InferSelectModel<typeof userRateLimits>

// Trigger types for rate limiting
export type TriggerType = 'api' | 'webhook' | 'schedule' | 'manual' | 'chat'

// Subscription plan types
export type SubscriptionPlan = 'free' | 'pro' | 'team' | 'enterprise'

// Rate limit configuration (applies to all non-manual trigger types: api, webhook, schedule, chat)
export interface RateLimitConfig {
  syncApiExecutionsPerMinute: number
  asyncApiExecutionsPerMinute: number
}

export const RATE_LIMITS: Record<SubscriptionPlan, RateLimitConfig> = {
  free: {
    syncApiExecutionsPerMinute: 10,
    asyncApiExecutionsPerMinute: 50,
  },
  pro: {
    syncApiExecutionsPerMinute: 25,
    asyncApiExecutionsPerMinute: 200,
  },
  team: {
    syncApiExecutionsPerMinute: 75,
    asyncApiExecutionsPerMinute: 500,
  },
  enterprise: {
    syncApiExecutionsPerMinute: 150,
    asyncApiExecutionsPerMinute: 1000,
  },
}

// Custom error for rate limits
export class RateLimitError extends Error {
  statusCode: number
  constructor(message: string, statusCode = 429) {
    super(message)
    this.name = 'RateLimitError'
    this.statusCode = statusCode
  }
}
