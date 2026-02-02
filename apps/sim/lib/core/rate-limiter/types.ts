import { env } from '@/lib/core/config/env'
import type { CoreTriggerType } from '@/stores/logs/filters/types'
import type { TokenBucketConfig } from './storage'

export type TriggerType = CoreTriggerType | 'form' | 'api-endpoint'

export type RateLimitCounterType = 'sync' | 'async' | 'api-endpoint'

export type SubscriptionPlan = 'free' | 'pro' | 'team' | 'enterprise'

export interface RateLimitConfig {
  sync: TokenBucketConfig
  async: TokenBucketConfig
  apiEndpoint: TokenBucketConfig
}

export const RATE_LIMIT_WINDOW_MS = Number.parseInt(env.RATE_LIMIT_WINDOW_MS) || 60000

export const MANUAL_EXECUTION_LIMIT = Number.parseInt(env.MANUAL_EXECUTION_LIMIT) || 999999

function createBucketConfig(ratePerMinute: number, burstMultiplier = 2): TokenBucketConfig {
  return {
    maxTokens: ratePerMinute * burstMultiplier,
    refillRate: ratePerMinute,
    refillIntervalMs: RATE_LIMIT_WINDOW_MS,
  }
}

export const RATE_LIMITS: Record<SubscriptionPlan, RateLimitConfig> = {
  free: {
    sync: createBucketConfig(Number.parseInt(env.RATE_LIMIT_FREE_SYNC) || 50),
    async: createBucketConfig(Number.parseInt(env.RATE_LIMIT_FREE_ASYNC) || 200),
    apiEndpoint: createBucketConfig(30),
  },
  pro: {
    sync: createBucketConfig(Number.parseInt(env.RATE_LIMIT_PRO_SYNC) || 150),
    async: createBucketConfig(Number.parseInt(env.RATE_LIMIT_PRO_ASYNC) || 1000),
    apiEndpoint: createBucketConfig(100),
  },
  team: {
    sync: createBucketConfig(Number.parseInt(env.RATE_LIMIT_TEAM_SYNC) || 300),
    async: createBucketConfig(Number.parseInt(env.RATE_LIMIT_TEAM_ASYNC) || 2500),
    apiEndpoint: createBucketConfig(200),
  },
  enterprise: {
    sync: createBucketConfig(Number.parseInt(env.RATE_LIMIT_ENTERPRISE_SYNC) || 600),
    async: createBucketConfig(Number.parseInt(env.RATE_LIMIT_ENTERPRISE_ASYNC) || 5000),
    apiEndpoint: createBucketConfig(500),
  },
}

export class RateLimitError extends Error {
  statusCode: number
  constructor(message: string, statusCode = 429) {
    super(message)
    this.name = 'RateLimitError'
    this.statusCode = statusCode
  }
}
