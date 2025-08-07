import type { InferSelectModel } from 'drizzle-orm'
import { env } from '@/lib/env'
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

// Rate limit window duration in milliseconds
export const RATE_LIMIT_WINDOW_MS = Number.parseInt(env.RATE_LIMIT_WINDOW_MS)

// Manual execution bypass value (effectively unlimited)
export const MANUAL_EXECUTION_LIMIT = Number.parseInt(env.MANUAL_EXECUTION_LIMIT)

export const RATE_LIMITS: Record<SubscriptionPlan, RateLimitConfig> = {
  free: {
    syncApiExecutionsPerMinute: Number.parseInt(env.RATE_LIMIT_FREE_SYNC),
    asyncApiExecutionsPerMinute: Number.parseInt(env.RATE_LIMIT_FREE_ASYNC),
  },
  pro: {
    syncApiExecutionsPerMinute: Number.parseInt(env.RATE_LIMIT_PRO_SYNC),
    asyncApiExecutionsPerMinute: Number.parseInt(env.RATE_LIMIT_PRO_ASYNC),
  },
  team: {
    syncApiExecutionsPerMinute: Number.parseInt(env.RATE_LIMIT_TEAM_SYNC),
    asyncApiExecutionsPerMinute: Number.parseInt(env.RATE_LIMIT_TEAM_ASYNC),
  },
  enterprise: {
    syncApiExecutionsPerMinute: Number.parseInt(env.RATE_LIMIT_ENTERPRISE_SYNC),
    asyncApiExecutionsPerMinute: Number.parseInt(env.RATE_LIMIT_ENTERPRISE_ASYNC),
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
