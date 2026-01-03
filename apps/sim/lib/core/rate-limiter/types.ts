import { env } from '@/lib/core/config/env'
import type { TokenBucketConfig } from './storage'

export type TriggerType =
  | 'api'
  | 'webhook'
  | 'schedule'
  | 'manual'
  | 'chat'
  | 'mcp'
  | 'form'
  | 'api-endpoint'

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
    sync: createBucketConfig(Number.parseInt(env.RATE_LIMIT_FREE_SYNC) || 10),
    async: createBucketConfig(Number.parseInt(env.RATE_LIMIT_FREE_ASYNC) || 50),
    apiEndpoint: createBucketConfig(10),
  },
  pro: {
    sync: createBucketConfig(Number.parseInt(env.RATE_LIMIT_PRO_SYNC) || 25),
    async: createBucketConfig(Number.parseInt(env.RATE_LIMIT_PRO_ASYNC) || 200),
    apiEndpoint: createBucketConfig(30),
  },
  team: {
    sync: createBucketConfig(Number.parseInt(env.RATE_LIMIT_TEAM_SYNC) || 75),
    async: createBucketConfig(Number.parseInt(env.RATE_LIMIT_TEAM_ASYNC) || 500),
    apiEndpoint: createBucketConfig(60),
  },
  enterprise: {
    sync: createBucketConfig(Number.parseInt(env.RATE_LIMIT_ENTERPRISE_SYNC) || 150),
    async: createBucketConfig(Number.parseInt(env.RATE_LIMIT_ENTERPRISE_ASYNC) || 1000),
    apiEndpoint: createBucketConfig(120),
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
