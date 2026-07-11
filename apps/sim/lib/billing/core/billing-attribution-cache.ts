import { createLogger } from '@sim/logger'
import { sha256Hex } from '@sim/security/hash'
import {
  assertBillingAttributionSnapshot,
  type BillingAttributionSnapshot,
} from '@/lib/billing/core/billing-attribution'
import { getRedisClient } from '@/lib/core/config/redis'

const logger = createLogger('BillingAttributionCache')
const ATTRIBUTION_CACHE_PREFIX = 'billing:attribution:v1:'
const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60
const CACHE_WRITE_MAX_ATTEMPTS = 3
const LEGACY_BILLING_KEY_SUFFIXES = ['-billing'] as const

/**
 * Compares the dedicated billing request alias against the value observed by
 * the caller before refreshing it.
 */
const COMPARE_AND_SET_IMMUTABLE_SCRIPT = `
for index, key in ipairs(KEYS) do
  local existing = redis.call('GET', key)
  local wasPresent = ARGV[(index * 2) + 1]
  local expected = ARGV[(index * 2) + 2]
  if wasPresent == '0' then
    if existing then
      return 0
    end
  elseif existing ~= expected then
    return 0
  end
end
for _, key in ipairs(KEYS) do
  redis.call('SET', key, ARGV[1], 'EX', ARGV[2])
end
return 1
`

export class BillingAttributionCacheConflictError extends Error {
  constructor(requestKey: string) {
    super(`Billing attribution cache conflict for request key "${requestKey}"`)
    this.name = 'BillingAttributionCacheConflictError'
  }
}

function attributionCacheKey(requestKey: string): string {
  return `${ATTRIBUTION_CACHE_PREFIX}${sha256Hex(requestKey)}`
}

function deserializeAttribution(serialized: string): BillingAttributionSnapshot {
  return assertBillingAttributionSnapshot(JSON.parse(serialized))
}

function normalizeRequestKeys(requestKeys: string | readonly string[]): string[] {
  const values = typeof requestKeys === 'string' ? [requestKeys] : requestKeys
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function legacyCandidateRequestKeys(idempotencyKey: string): string[] {
  const candidates = [idempotencyKey]
  for (const suffix of LEGACY_BILLING_KEY_SUFFIXES) {
    if (idempotencyKey.endsWith(suffix)) {
      candidates.push(idempotencyKey.slice(0, -suffix.length))
    }
  }
  return [...new Set(candidates.filter(Boolean))]
}

function assertEquivalentCachedAttributions(
  requestKeys: readonly string[],
  values: Array<string | null>,
  serializedAttribution: string
): void {
  for (const [index, value] of values.entries()) {
    if (value === null) continue

    const requestKey = requestKeys[index]
    let existing: BillingAttributionSnapshot
    try {
      existing = deserializeAttribution(value)
    } catch (error) {
      throw new Error(`Cached billing attribution for request key "${requestKey}" is invalid`, {
        cause: error,
      })
    }

    if (JSON.stringify(existing) !== serializedAttribution) {
      throw new BillingAttributionCacheConflictError(requestKey)
    }
  }
}

/**
 * Persists legacy aliases while markerless and legacy-v0 checkpoints drain.
 * Modern protocols carry their immutable decision in the request envelope and
 * never depend on this cache.
 */
export async function cacheBillingAttribution(
  requestKeys: string | readonly string[],
  attribution: BillingAttributionSnapshot
): Promise<boolean> {
  const redis = getRedisClient()
  if (!redis) return false

  const validated = assertBillingAttributionSnapshot(attribution)
  const uniqueRequestKeys = normalizeRequestKeys(requestKeys)
  if (uniqueRequestKeys.length === 0) return false

  const serialized = JSON.stringify(validated)
  const redisKeys = uniqueRequestKeys.map(attributionCacheKey)

  for (let attempt = 0; attempt < CACHE_WRITE_MAX_ATTEMPTS; attempt++) {
    const existingValues = await redis.mget(...redisKeys)
    if (existingValues.length !== redisKeys.length) {
      throw new Error('Billing attribution cache returned an incomplete snapshot')
    }
    assertEquivalentCachedAttributions(uniqueRequestKeys, existingValues, serialized)

    const expectedValues = existingValues.flatMap((value) =>
      value === null ? ['0', ''] : ['1', value]
    )
    const result = await redis.eval(
      COMPARE_AND_SET_IMMUTABLE_SCRIPT,
      redisKeys.length,
      ...redisKeys,
      serialized,
      CACHE_TTL_SECONDS.toString(),
      ...expectedValues
    )
    if (result === 1) return true
    if (result !== 0) {
      throw new Error('Billing attribution cache returned an unexpected atomic write result')
    }
  }

  throw new Error('Billing attribution cache changed concurrently during immutable write')
}

/**
 * Restores the pre-hosted-work decision used by a cumulative Go cost flush,
 * including the old `messageId-billing` suffix while legacy checkpoints drain.
 */
export async function getCachedBillingAttribution(
  idempotencyKey: string
): Promise<BillingAttributionSnapshot | undefined> {
  const redis = getRedisClient()
  if (!redis) return undefined

  const candidateKeys = legacyCandidateRequestKeys(idempotencyKey)
  const values = await redis.mget(...candidateKeys.map(attributionCacheKey))

  try {
    for (const value of values) {
      if (value) return deserializeAttribution(value)
    }
    return undefined
  } catch (error) {
    logger.error('Cached billing attribution is invalid', {
      idempotencyKey,
      error,
    })
    throw error
  }
}
