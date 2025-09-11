import type { InferSelectModel } from 'drizzle-orm'
import { env } from '@/lib/env'
import type { userRateLimits } from '@/db/schema'

// Database types
export type UserRateLimit = InferSelectModel<typeof userRateLimits>

// Trigger types for rate limiting
export type TriggerType = 'api' | 'webhook' | 'schedule' | 'manual' | 'chat' | 'api-endpoint'

// Rate limit counter types - which counter to increment in the database
export type RateLimitCounterType = 'sync' | 'async' | 'api-endpoint'

// Subscription plan types
export type SubscriptionPlan = 'free' | 'pro' | 'team' | 'enterprise'

// Rate limit configuration (applies to all non-manual trigger types: api, webhook, schedule, chat, api-endpoint)
export interface RateLimitConfig {
  syncApiExecutionsPerMinute: number
  asyncApiExecutionsPerMinute: number
  apiEndpointRequestsPerMinute: number // For external API endpoints like /api/v1/logs
}

// Rate limit window duration in milliseconds
export const RATE_LIMIT_WINDOW_MS = Number.parseInt(env.RATE_LIMIT_WINDOW_MS) || 60000

// Manual execution bypass value (effectively unlimited)
export const MANUAL_EXECUTION_LIMIT = Number.parseInt(env.MANUAL_EXECUTION_LIMIT) || 999999

export const RATE_LIMITS: Record<SubscriptionPlan, RateLimitConfig> = {
  free: {
    syncApiExecutionsPerMinute: Number.parseInt(env.RATE_LIMIT_FREE_SYNC) || 10,
    asyncApiExecutionsPerMinute: Number.parseInt(env.RATE_LIMIT_FREE_ASYNC) || 50,
    apiEndpointRequestsPerMinute: 10,
  },
  pro: {
    syncApiExecutionsPerMinute: Number.parseInt(env.RATE_LIMIT_PRO_SYNC) || 25,
    asyncApiExecutionsPerMinute: Number.parseInt(env.RATE_LIMIT_PRO_ASYNC) || 200,
    apiEndpointRequestsPerMinute: 30,
  },
  team: {
    syncApiExecutionsPerMinute: Number.parseInt(env.RATE_LIMIT_TEAM_SYNC) || 75,
    asyncApiExecutionsPerMinute: Number.parseInt(env.RATE_LIMIT_TEAM_ASYNC) || 500,
    apiEndpointRequestsPerMinute: 60,
  },
  enterprise: {
    syncApiExecutionsPerMinute: Number.parseInt(env.RATE_LIMIT_ENTERPRISE_SYNC) || 150,
    asyncApiExecutionsPerMinute: Number.parseInt(env.RATE_LIMIT_ENTERPRISE_ASYNC) || 1000,
    apiEndpointRequestsPerMinute: 120,
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
