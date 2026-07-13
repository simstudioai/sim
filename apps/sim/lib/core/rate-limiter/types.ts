import { getPlanTypeForLimits } from '@/lib/billing/plan-helpers'
import { env } from '@/lib/core/config/env'
import { isBillingEnabled } from '@/lib/core/config/env-flags'
import type { CoreTriggerType } from '@/stores/logs/filters/types'
import type { TokenBucketConfig } from './storage'

export type TriggerType = CoreTriggerType | 'api-endpoint'

export type RateLimitCounterType = 'sync' | 'async' | 'api-endpoint'

type RateLimitConfigKey = 'sync' | 'async' | 'apiEndpoint'

export type SubscriptionPlan = 'free' | 'pro' | 'team' | 'enterprise'

export interface RateLimitConfig {
  sync: TokenBucketConfig
  async: TokenBucketConfig
  apiEndpoint: TokenBucketConfig
}

export const RATE_LIMIT_WINDOW_MS = Number.parseInt(env.RATE_LIMIT_WINDOW_MS) || 60000

export const MANUAL_EXECUTION_LIMIT = Number.parseInt(env.MANUAL_EXECUTION_LIMIT) || 999999

const DEFAULT_RATE_LIMITS = {
  free: { sync: 50, async: 200, apiEndpoint: 30 },
  pro: { sync: 150, async: 1000, apiEndpoint: 100 },
  team: { sync: 300, async: 2500, apiEndpoint: 200 },
  enterprise: { sync: 600, async: 5000, apiEndpoint: 500 },
} as const

function toConfigKey(type: RateLimitCounterType): RateLimitConfigKey {
  return type === 'api-endpoint' ? 'apiEndpoint' : type
}

function createBucketConfig(ratePerMinute: number, burstMultiplier = 2): TokenBucketConfig {
  return {
    maxTokens: ratePerMinute * burstMultiplier,
    refillRate: ratePerMinute,
    refillIntervalMs: RATE_LIMIT_WINDOW_MS,
  }
}

function getRateLimitForPlan(plan: SubscriptionPlan, type: RateLimitConfigKey): TokenBucketConfig {
  const envVarMap: Record<SubscriptionPlan, Record<RateLimitConfigKey, string | undefined>> = {
    free: {
      sync: env.RATE_LIMIT_FREE_SYNC,
      async: env.RATE_LIMIT_FREE_ASYNC,
      apiEndpoint: env.RATE_LIMIT_FREE_API_ENDPOINT,
    },
    pro: { sync: env.RATE_LIMIT_PRO_SYNC, async: env.RATE_LIMIT_PRO_ASYNC, apiEndpoint: undefined },
    team: {
      sync: env.RATE_LIMIT_TEAM_SYNC,
      async: env.RATE_LIMIT_TEAM_ASYNC,
      apiEndpoint: undefined,
    },
    enterprise: {
      sync: env.RATE_LIMIT_ENTERPRISE_SYNC,
      async: env.RATE_LIMIT_ENTERPRISE_ASYNC,
      apiEndpoint: undefined,
    },
  }

  const rate = Number.parseInt(envVarMap[plan][type] || '') || DEFAULT_RATE_LIMITS[plan][type]
  return createBucketConfig(rate)
}

export const RATE_LIMITS: Record<SubscriptionPlan, RateLimitConfig> = {
  free: {
    sync: getRateLimitForPlan('free', 'sync'),
    async: getRateLimitForPlan('free', 'async'),
    apiEndpoint: getRateLimitForPlan('free', 'apiEndpoint'),
  },
  pro: {
    sync: getRateLimitForPlan('pro', 'sync'),
    async: getRateLimitForPlan('pro', 'async'),
    apiEndpoint: getRateLimitForPlan('pro', 'apiEndpoint'),
  },
  team: {
    sync: getRateLimitForPlan('team', 'sync'),
    async: getRateLimitForPlan('team', 'async'),
    apiEndpoint: getRateLimitForPlan('team', 'apiEndpoint'),
  },
  enterprise: {
    sync: getRateLimitForPlan('enterprise', 'sync'),
    async: getRateLimitForPlan('enterprise', 'async'),
    apiEndpoint: getRateLimitForPlan('enterprise', 'apiEndpoint'),
  },
}

/** Effectively-unlimited bucket used when billing-disabled deployments opt out of a limit. */
const UNLIMITED_RATE_LIMIT: TokenBucketConfig = createBucketConfig(MANUAL_EXECUTION_LIMIT, 1)

function freeRateLimitOverride(type: RateLimitConfigKey): string | undefined {
  const overrides: Record<RateLimitConfigKey, string | undefined> = {
    sync: env.RATE_LIMIT_FREE_SYNC,
    async: env.RATE_LIMIT_FREE_ASYNC,
    apiEndpoint: env.RATE_LIMIT_FREE_API_ENDPOINT,
  }
  return overrides[type]
}

/**
 * Billing-enabled deployments enforce per-plan limits. Billing-disabled
 * deployments are unlimited unless the operator explicitly set the free-tier
 * env var for that counter, which opts back into enforcement at that rate.
 */
export function getRateLimit(
  plan: SubscriptionPlan | string | undefined,
  type: RateLimitCounterType
): TokenBucketConfig {
  const key = toConfigKey(type)
  if (!isBillingEnabled) {
    const override = Number.parseInt(freeRateLimitOverride(key) || '')
    return Number.isFinite(override) && override > 0 ? RATE_LIMITS.free[key] : UNLIMITED_RATE_LIMIT
  }
  return RATE_LIMITS[getPlanTypeForLimits(plan)][key]
}

export class RateLimitError extends Error {
  statusCode: number
  constructor(message: string, statusCode = 429) {
    super(message)
    this.name = 'RateLimitError'
    this.statusCode = statusCode
  }
}
