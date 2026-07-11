import { createLogger } from '@sim/logger'
import { sha256Hex } from '@sim/security/hash'
import { generateId } from '@sim/utils/id'
import { isRecordLike } from '@sim/utils/object'
import {
  assertBillingAttributionSnapshot,
  type BillingAttributionSnapshot,
  serializeBillingAttributionHeader,
} from '@/lib/billing/core/billing-attribution'
import type { BillingEntity } from '@/lib/billing/core/usage-log'
import {
  BILLING_ATTRIBUTION_HEADER,
  BILLING_REQUEST_ID_HEADER,
  COPILOT_BILLING_PROTOCOL,
  COPILOT_BILLING_PROTOCOL_HEADER,
} from '@/lib/copilot/generated/billing-protocol-v1'
import { getRedisClient } from '@/lib/core/config/redis'

const logger = createLogger('BillingAttributionCache')
const ATTRIBUTION_CACHE_PREFIX = 'billing:attribution:v1:'
const ACCOUNT_DECISION_CACHE_PREFIX = 'billing:account-decision:v1:'
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

export interface AttributedBillingRequestEnvelope {
  billingRequestId: string
  serializedAttribution: string
  headers: Record<string, string>
}

export interface AccountBillingDecision {
  readonly userId: string
  readonly billingEntity: BillingEntity
  readonly billingPeriod: {
    readonly start: string
    readonly end: string
  }
}

function attributionCacheKey(requestKey: string): string {
  return `${ATTRIBUTION_CACHE_PREFIX}${sha256Hex(requestKey)}`
}

function accountDecisionCacheKey(requestKey: string): string {
  return `${ACCOUNT_DECISION_CACHE_PREFIX}${sha256Hex(requestKey)}`
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
 * Persists one immutable decision. Attributed-v1 writes only its dedicated
 * server identity; the pre-cutover compatibility stage may supply legacy
 * aliases for old in-flight checkpoint billing. A missing Redis client returns
 * `false`; attributed-v1 callers must treat that as a pre-execution failure.
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
 * Persists immutable attribution and fails with the caller's producer-specific
 * message when the cache is unavailable.
 */
export async function cacheBillingAttributionOrThrow(
  requestKeys: string | readonly string[],
  attribution: BillingAttributionSnapshot,
  errorMessage: string
): Promise<void> {
  const cached = await cacheBillingAttribution(requestKeys, attribution)
  if (!cached) {
    throw new Error(errorMessage)
  }
}

/**
 * Allocates one server billing identity, caches its immutable attribution, and
 * returns the complete attributed-v1 request envelope.
 */
export async function createAttributedBillingRequestEnvelope(
  attribution: BillingAttributionSnapshot,
  cacheErrorMessage: string
): Promise<AttributedBillingRequestEnvelope> {
  const validatedAttribution = assertBillingAttributionSnapshot(attribution)
  const billingRequestId = generateId()
  await cacheBillingAttributionOrThrow(billingRequestId, validatedAttribution, cacheErrorMessage)
  const serializedAttribution = serializeBillingAttributionHeader(validatedAttribution)

  return {
    billingRequestId,
    serializedAttribution,
    headers: {
      [COPILOT_BILLING_PROTOCOL_HEADER]: COPILOT_BILLING_PROTOCOL.attributed,
      [BILLING_REQUEST_ID_HEADER]: billingRequestId,
      [BILLING_ATTRIBUTION_HEADER]: serializedAttribution,
    },
  }
}

function assertAccountBillingDecision(value: unknown): AccountBillingDecision {
  if (!isRecordLike(value) || typeof value.userId !== 'string' || !value.userId.trim()) {
    throw new Error('Account billing decision must contain a user ID')
  }
  if (
    !isRecordLike(value.billingEntity) ||
    (value.billingEntity.type !== 'user' && value.billingEntity.type !== 'organization') ||
    typeof value.billingEntity.id !== 'string' ||
    !value.billingEntity.id.trim()
  ) {
    throw new Error('Account billing decision must contain a billing entity')
  }
  if (
    !isRecordLike(value.billingPeriod) ||
    typeof value.billingPeriod.start !== 'string' ||
    typeof value.billingPeriod.end !== 'string' ||
    !Number.isFinite(Date.parse(value.billingPeriod.start)) ||
    !Number.isFinite(Date.parse(value.billingPeriod.end))
  ) {
    throw new Error('Account billing decision must contain a valid billing period')
  }
  return Object.freeze({
    userId: value.userId,
    billingEntity: Object.freeze({
      type: value.billingEntity.type,
      id: value.billingEntity.id,
    }),
    billingPeriod: Object.freeze({
      start: new Date(value.billingPeriod.start).toISOString(),
      end: new Date(value.billingPeriod.end).toISOString(),
    }),
  })
}

/**
 * Persists the immutable hosted account selected by an authenticated
 * Copilot/Chat API key. The local self-hosted workspace is intentionally not
 * part of this decision.
 */
export async function cacheAccountBillingDecisionOrThrow(
  billingRequestId: string,
  decision: AccountBillingDecision,
  errorMessage: string
): Promise<void> {
  const redis = getRedisClient()
  if (!redis) throw new Error(errorMessage)

  const requestKey = billingRequestId.trim()
  if (!requestKey) throw new Error(errorMessage)

  const serialized = JSON.stringify(assertAccountBillingDecision(decision))
  const redisKey = accountDecisionCacheKey(requestKey)

  for (let attempt = 0; attempt < CACHE_WRITE_MAX_ATTEMPTS; attempt++) {
    const existingValues = await redis.mget(redisKey)
    if (existingValues.length !== 1) {
      throw new Error('Account billing decision cache returned an incomplete snapshot')
    }
    const [existing] = existingValues
    if (existing !== null) {
      let cached: AccountBillingDecision
      try {
        cached = assertAccountBillingDecision(JSON.parse(existing))
      } catch (error) {
        throw new Error(
          `Cached account billing decision for request key "${requestKey}" is invalid`,
          {
            cause: error,
          }
        )
      }
      if (JSON.stringify(cached) !== serialized) {
        throw new Error(`Account billing decision conflicts for request key "${requestKey}"`)
      }
    }

    const result = await redis.eval(
      COMPARE_AND_SET_IMMUTABLE_SCRIPT,
      1,
      redisKey,
      serialized,
      CACHE_TTL_SECONDS.toString(),
      existing === null ? '0' : '1',
      existing ?? ''
    )
    if (result === 1) return
    if (result !== 0) {
      throw new Error('Account billing decision cache returned an unexpected atomic write result')
    }
  }

  throw new Error('Account billing decision cache changed concurrently during immutable write')
}

/**
 * Restores the hosted account selected during direct-v1 admission.
 */
export async function getCachedAccountBillingDecision(
  billingRequestId: string
): Promise<AccountBillingDecision | undefined> {
  const redis = getRedisClient()
  if (!redis) return undefined

  const values = await redis.mget(accountDecisionCacheKey(billingRequestId))
  if (values.length !== 1) {
    throw new Error('Account billing decision cache returned an incomplete snapshot')
  }
  const [serialized] = values
  if (!serialized) return undefined

  try {
    return assertAccountBillingDecision(JSON.parse(serialized))
  } catch (error) {
    logger.error('Cached account billing decision is invalid', {
      billingRequestId,
      error,
    })
    throw error
  }
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
