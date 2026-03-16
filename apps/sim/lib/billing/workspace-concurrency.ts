import { createLogger } from '@sim/logger'
import { getHighestPrioritySubscription } from '@/lib/billing/core/plan'
import { getPlanTierCredits, isEnterprise, isPro, isTeam } from '@/lib/billing/plan-helpers'
import { parseEnterpriseWorkspaceConcurrencyMetadata } from '@/lib/billing/types'
import { env } from '@/lib/core/config/env'
import { isBillingEnabled } from '@/lib/core/config/feature-flags'
import { getRedisClient } from '@/lib/core/config/redis'
import { getWorkspaceBilledAccountUserId } from '@/lib/workspaces/utils'

const logger = createLogger('WorkspaceConcurrencyBilling')

const CACHE_TTL_MS = 60_000
const CACHE_TTL_SECONDS = Math.floor(CACHE_TTL_MS / 1000)

interface CacheEntry {
  value: number
  expiresAt: number
}

const inMemoryConcurrencyCache = new Map<string, CacheEntry>()

function cacheKey(workspaceId: string): string {
  return `workspace-concurrency-limit:${workspaceId}`
}

function parsePositiveLimit(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value)
  }

  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed
    }
  }

  return null
}

function getFreeConcurrencyLimit(): number {
  return Number.parseInt(env.WORKSPACE_CONCURRENCY_FREE, 10) || 5
}

function getProConcurrencyLimit(): number {
  return Number.parseInt(env.WORKSPACE_CONCURRENCY_PRO, 10) || 50
}

function getTeamConcurrencyLimit(): number {
  return Number.parseInt(env.WORKSPACE_CONCURRENCY_TEAM, 10) || 200
}

function getEnterpriseDefaultConcurrencyLimit(): number {
  return Number.parseInt(env.WORKSPACE_CONCURRENCY_ENTERPRISE, 10) || 200
}

function getEnterpriseConcurrencyLimit(metadata: unknown): number {
  const enterpriseMetadata = parseEnterpriseWorkspaceConcurrencyMetadata(metadata)
  return enterpriseMetadata?.workspaceConcurrencyLimit ?? getEnterpriseDefaultConcurrencyLimit()
}

function getPlanConcurrencyLimit(plan: string | null | undefined, metadata: unknown): number {
  if (!isBillingEnabled) {
    return getFreeConcurrencyLimit()
  }

  if (!plan) {
    return getFreeConcurrencyLimit()
  }

  if (isEnterprise(plan)) {
    return getEnterpriseConcurrencyLimit(metadata)
  }

  if (isTeam(plan)) {
    return getTeamConcurrencyLimit()
  }

  const credits = getPlanTierCredits(plan)
  if (credits >= 25_000) {
    return getTeamConcurrencyLimit()
  }

  if (isPro(plan)) {
    return getProConcurrencyLimit()
  }

  return getFreeConcurrencyLimit()
}

export async function getWorkspaceConcurrencyLimit(workspaceId: string): Promise<number> {
  const redis = getRedisClient()

  if (redis) {
    const cached = await redis.get(cacheKey(workspaceId))
    const cachedValue = parsePositiveLimit(cached)
    if (cachedValue !== null) {
      return cachedValue
    }
  } else {
    const cached = inMemoryConcurrencyCache.get(workspaceId)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value
    }
  }

  try {
    const billedAccountUserId = await getWorkspaceBilledAccountUserId(workspaceId)
    if (!billedAccountUserId) {
      if (redis) {
        await redis.set(
          cacheKey(workspaceId),
          String(getFreeConcurrencyLimit()),
          'EX',
          CACHE_TTL_SECONDS
        )
      } else {
        inMemoryConcurrencyCache.set(workspaceId, {
          value: getFreeConcurrencyLimit(),
          expiresAt: Date.now() + CACHE_TTL_MS,
        })
      }
      return getFreeConcurrencyLimit()
    }

    const subscription = await getHighestPrioritySubscription(billedAccountUserId)
    const limit = getPlanConcurrencyLimit(subscription?.plan, subscription?.metadata)

    if (redis) {
      await redis.set(cacheKey(workspaceId), String(limit), 'EX', CACHE_TTL_SECONDS)
    } else {
      inMemoryConcurrencyCache.set(workspaceId, {
        value: limit,
        expiresAt: Date.now() + CACHE_TTL_MS,
      })
    }

    return limit
  } catch (error) {
    logger.error('Failed to resolve workspace concurrency limit, using free tier', {
      workspaceId,
      error,
    })

    return getFreeConcurrencyLimit()
  }
}

export async function resetWorkspaceConcurrencyLimitCache(workspaceId?: string): Promise<void> {
  if (!workspaceId) {
    inMemoryConcurrencyCache.clear()
  } else {
    inMemoryConcurrencyCache.delete(workspaceId)
  }

  const redis = getRedisClient()
  if (!redis) {
    return
  }

  if (workspaceId) {
    await redis.del(cacheKey(workspaceId))
    return
  }

  const keys = await redis.keys('workspace-concurrency-limit:*')
  if (keys.length > 0) {
    await redis.del(...keys)
  }
}
