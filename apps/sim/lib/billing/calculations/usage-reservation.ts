import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import { BASE_EXECUTION_CHARGE } from '@/lib/billing/constants'
import type { BillingEntity } from '@/lib/billing/core/usage-log'
import { getPlanTypeForLimits } from '@/lib/billing/plan-helpers'
import {
  ADMISSION_ERROR_DESCRIPTOR,
  type ReservationDenialReason,
} from '@/lib/core/admission/transient-failure'
import { isBillingEnabled, isHosted } from '@/lib/core/config/env-flags'
import { getRedisClient } from '@/lib/core/config/redis'
import { getExecutionReservationTtlMs } from '@/lib/core/execution-limits'
import type { SubscriptionPlan } from '@/lib/core/rate-limiter/types'

const logger = createLogger('UsageReservation')

/**
 * Maximum number of simultaneously in-flight (admitted but not-yet-costed)
 * executions a single billing entity may hold at once.
 *
 * The usage-cap admission gate reads already-recorded cost, but cost is only
 * written when an execution finishes. Without a reservation, N parallel
 * executions all read the same pre-burst usage, all pass the cap, and all run —
 * collectively spending far past the cap before any cost lands in the ledger
 * (free-tier abuse / hard-cap defeat). Bounding the number of in-flight
 * executions per billing entity bounds the worst-case overshoot to roughly this
 * many executions' worth of spend.
 */
const MAX_CONCURRENT_EXECUTIONS: Record<SubscriptionPlan, number> = {
  free: 15,
  pro: 75,
  team: 150,
  enterprise: 300,
}

/**
 * The guaranteed $0.005 base charge reserved per active execution. This is not
 * an estimate of final model or tool spend; it only closes the concurrent race
 * around the minimum charge that every execution is guaranteed to incur.
 */
const RESERVED_BASE_EXECUTION_CHARGE = BASE_EXECUTION_CHARGE

/**
 * Identifiers are bounded before becoming Redis keys or pointer data. With the
 * 300-entry enterprise ceiling, one payer can hold at most 300 owner keys, 300
 * pointer keys, 300 member keys, one payer key, and 600 total sorted-set
 * entries. Each generated key is below 450 bytes and each pointer below 512
 * bytes: at most 901 keys and under 626 KiB of application-controlled
 * key/member/value/score bytes per payer, excluding bounded Redis object
 * overhead. Absolute TTLs bound crash remnants; pause paths explicitly release
 * them.
 */
const MAX_IDENTIFIER_LENGTH = 128
const MAX_POINTER_BYTES = 512
const POINTER_VERSION = 1
const POINTER_KEY_PREFIX = 'usage:reservation:'
const PAYER_KEY_PREFIX = 'usage:inflight:'
const OWNER_KEY_PREFIX = 'usage:owner:'

const RESERVE_CREATED = 1
const RESERVE_PAYER_CONCURRENCY_FULL = 2
const RESERVE_PAYER_HEADROOM_FULL = 3
const RESERVE_MEMBER_HEADROOM_FULL = 4
const RESERVE_DUPLICATE = 5

/**
 * Atomically prunes expired entries, checks the payer ceiling and optional
 * member base-charge headroom, then inserts both constraints. All declared keys
 * share the payer hash tag, so Redis Cluster executes the script in one slot.
 *
 * The script performs only constant-size scalar work plus sorted-set operations
 * over at most `maxConcurrency` entries (300). No Lua collection grows with
 * traffic. Base-charge slots have no floor: zero remaining guaranteed-minimum
 * charges is a headroom rejection, while duplicate execution ids remain
 * idempotent.
 */
const RESERVE_SCRIPT = `
local now = tonumber(ARGV[1])
local expiryScore = tonumber(ARGV[2])
local maxConcurrency = tonumber(ARGV[3])
local payerBaseChargeSlots = tonumber(ARGV[4])
local expiryAt = tonumber(ARGV[7])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
if KEYS[3] then
  redis.call('ZREMRANGEBYSCORE', KEYS[3], '-inf', now)
end
local owner = redis.call('GET', KEYS[2])
if owner then
  if owner ~= ARGV[6] then
    return -1
  end
  local payerReservation = redis.call('ZSCORE', KEYS[1], ARGV[5])
  local memberReservation = true
  if KEYS[3] then
    memberReservation = redis.call('ZSCORE', KEYS[3], ARGV[5])
  end
  if payerReservation and memberReservation then
    redis.call('ZADD', KEYS[1], expiryScore, ARGV[5])
    redis.call('PEXPIREAT', KEYS[1], expiryAt)
    if KEYS[3] then
      redis.call('ZADD', KEYS[3], expiryScore, ARGV[5])
      redis.call('PEXPIREAT', KEYS[3], expiryAt)
    end
    redis.call('PEXPIREAT', KEYS[2], expiryAt)
    return ${RESERVE_DUPLICATE}
  end
  redis.call('ZREM', KEYS[1], ARGV[5])
  if KEYS[3] then
    redis.call('ZREM', KEYS[3], ARGV[5])
  end
  redis.call('DEL', KEYS[2])
end

if payerBaseChargeSlots > maxConcurrency then payerBaseChargeSlots = maxConcurrency end
local payerCount = redis.call('ZCARD', KEYS[1])
if payerCount >= maxConcurrency then
  return ${RESERVE_PAYER_CONCURRENCY_FULL}
end
if payerCount >= payerBaseChargeSlots then
  return ${RESERVE_PAYER_HEADROOM_FULL}
end

if KEYS[3] then
  local memberBaseChargeSlots = tonumber(ARGV[8])
  if memberBaseChargeSlots > maxConcurrency then memberBaseChargeSlots = maxConcurrency end
  if redis.call('ZCARD', KEYS[3]) >= memberBaseChargeSlots then
    return ${RESERVE_MEMBER_HEADROOM_FULL}
  end
end

redis.call('ZADD', KEYS[1], expiryScore, ARGV[5])
redis.call('PEXPIREAT', KEYS[1], expiryAt)
if KEYS[3] then
  redis.call('ZADD', KEYS[3], expiryScore, ARGV[5])
  redis.call('PEXPIREAT', KEYS[3], expiryAt)
end
redis.call('SET', KEYS[2], ARGV[6], 'PXAT', expiryAt)
return ${RESERVE_CREATED}
`

/**
 * Registers the execution-to-payer pointer in its own hash slot. This separate
 * one-key script is cluster-safe and distinguishes an idempotent duplicate from
 * an execution-id collision.
 */
const REGISTER_POINTER_SCRIPT = `
local existing = redis.call('GET', KEYS[1])
if not existing then
  redis.call('SET', KEYS[1], ARGV[1], 'PXAT', ARGV[2])
  return 1
end
if existing == ARGV[1] then
  redis.call('PEXPIREAT', KEYS[1], ARGV[2])
  return 2
end
return 0
`

/**
 * Removes every payer-slot constraint under one atomic owner check. It is used
 * for both rollback and terminal release; repeated calls return zero without
 * removing another owner's data.
 */
const RELEASE_LOCAL_SCRIPT = `
local owner = redis.call('GET', KEYS[2])
if not owner then
  return 0
end
if owner ~= ARGV[2] then
  return -1
end
redis.call('ZREM', KEYS[1], ARGV[1])
if KEYS[3] then
  redis.call('ZREM', KEYS[3], ARGV[1])
end
redis.call('DEL', KEYS[2])
return 1
`

/**
 * Deletes a pointer only when it still identifies the released reservation.
 */
const DELETE_POINTER_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`

interface MemberReservationConstraint {
  organizationId: string
  actorUserId: string
  currentUsage: number
  limit: number
}

interface ReservationDescriptor {
  version: typeof POINTER_VERSION
  entityKey: string
  member?: {
    organizationId: string
    actorUserId: string
  }
}

interface LocalReservationKeys {
  payerKey: string
  ownerKey: string
  memberKey?: string
}

export class UsageReservationUnavailableError extends Error {
  readonly code = ADMISSION_ERROR_DESCRIPTOR.RESERVATION_INFRASTRUCTURE.code
  readonly statusCode = ADMISSION_ERROR_DESCRIPTOR.RESERVATION_INFRASTRUCTURE.statusCode
  readonly retryable = ADMISSION_ERROR_DESCRIPTOR.RESERVATION_INFRASTRUCTURE.retryable

  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'UsageReservationUnavailableError'
    this.cause = cause
  }
}

/**
 * Stable reservation key for the already-resolved workspace payer.
 */
export function resolveBillingEntityKey(billingEntity: BillingEntity): string {
  const id = requireBoundedIdentifier(billingEntity.id, 'billing entity')
  return `${billingEntity.type === 'organization' ? 'org' : 'user'}:${id}`
}

function getMaxConcurrentExecutions(plan: string | null | undefined): number {
  return MAX_CONCURRENT_EXECUTIONS[getPlanTypeForLimits(plan) as SubscriptionPlan]
}

function requireBoundedIdentifier(value: string, label: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    Buffer.byteLength(value, 'utf8') > MAX_IDENTIFIER_LENGTH ||
    !/^[A-Za-z0-9._:-]+$/.test(value)
  ) {
    throw new UsageReservationUnavailableError(`Invalid ${label} for usage reservation`)
  }
  return value
}

function requireUsageNumber(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new UsageReservationUnavailableError(`Invalid ${label} for usage reservation`)
  }
  return value
}

function buildDescriptor(
  entityKey: string,
  member: MemberReservationConstraint | undefined
): ReservationDescriptor {
  return {
    version: POINTER_VERSION,
    entityKey,
    ...(member
      ? {
          member: {
            organizationId: requireBoundedIdentifier(member.organizationId, 'member organization'),
            actorUserId: requireBoundedIdentifier(member.actorUserId, 'member actor'),
          },
        }
      : {}),
  }
}

function serializeDescriptor(descriptor: ReservationDescriptor): string {
  const serialized = JSON.stringify(descriptor)
  if (Buffer.byteLength(serialized, 'utf8') > MAX_POINTER_BYTES) {
    throw new UsageReservationUnavailableError('Usage reservation pointer exceeds size limit')
  }
  return serialized
}

function parseDescriptor(value: string): ReservationDescriptor | null {
  if (Buffer.byteLength(value, 'utf8') > MAX_POINTER_BYTES) return null
  try {
    const parsed = JSON.parse(value)
    const entityKey =
      isRecordLike(parsed) && typeof parsed.entityKey === 'string' ? parsed.entityKey : null
    const entityMatch =
      typeof entityKey === 'string' ? entityKey.match(/^(org|user):([A-Za-z0-9._:-]+)$/) : null
    const entityId = entityMatch?.[2]
    if (
      !isRecordLike(parsed) ||
      parsed.version !== POINTER_VERSION ||
      typeof entityKey !== 'string' ||
      typeof entityId !== 'string' ||
      Buffer.byteLength(entityId, 'utf8') > MAX_IDENTIFIER_LENGTH
    ) {
      return null
    }
    if (parsed.member === undefined) {
      return { version: POINTER_VERSION, entityKey }
    }
    if (
      !isRecordLike(parsed.member) ||
      typeof parsed.member.organizationId !== 'string' ||
      typeof parsed.member.actorUserId !== 'string'
    ) {
      return null
    }
    const organizationId = requireBoundedIdentifier(
      parsed.member.organizationId,
      'member organization'
    )
    const actorUserId = requireBoundedIdentifier(parsed.member.actorUserId, 'member actor')
    if (parsed.entityKey !== `org:${organizationId}`) return null
    return {
      version: POINTER_VERSION,
      entityKey,
      member: { organizationId, actorUserId },
    }
  } catch {
    return null
  }
}

function buildLocalKeys(
  descriptor: ReservationDescriptor,
  executionId: string
): LocalReservationKeys {
  const tag = `{${descriptor.entityKey}}`
  return {
    payerKey: `${PAYER_KEY_PREFIX}${tag}:payer`,
    ownerKey: `${OWNER_KEY_PREFIX}${tag}:${executionId}`,
    ...(descriptor.member
      ? {
          memberKey: `${PAYER_KEY_PREFIX}${tag}:member:${descriptor.member.organizationId}:${descriptor.member.actorUserId}`,
        }
      : {}),
  }
}

function localKeyArguments(keys: LocalReservationKeys): string[] {
  return keys.memberKey
    ? [keys.payerKey, keys.ownerKey, keys.memberKey]
    : [keys.payerKey, keys.ownerKey]
}

async function rollbackCreatedReservation(params: {
  redis: NonNullable<ReturnType<typeof getRedisClient>>
  keys: LocalReservationKeys
  executionId: string
  descriptorValue: string
}): Promise<boolean> {
  try {
    const keyArgs = localKeyArguments(params.keys)
    const result = await params.redis.eval(
      RELEASE_LOCAL_SCRIPT,
      keyArgs.length,
      ...keyArgs,
      params.executionId,
      params.descriptorValue
    )
    return result === 0 || result === 1
  } catch (error) {
    logger.error('Unable to prove usage reservation rollback', {
      executionId: params.executionId,
      error: toError(error).message,
    })
    return false
  }
}

export interface ReserveExecutionSlotParams {
  billingEntity: BillingEntity
  executionId: string
  plan: string | null | undefined
  /** Recorded usage for the billing entity at admission time (dollars). */
  currentUsage: number
  /** The entity's usage cap (dollars). */
  limit: number
  /** Optional exact organization-member cap captured by the attributed usage check. */
  member?: MemberReservationConstraint
}

export type ReserveExecutionSlotResult =
  | { reserved: true; created: boolean }
  | {
      reserved: false
      reason: ReservationDenialReason
    }

/**
 * Atomic admission reservation that closes the usage-cap check-then-use race.
 *
 * Billing-disabled and self-hosted deployments are no-ops. Hosted deployments
 * require Redis and fail closed when reservation or pointer ownership cannot be
 * proven. A newly-created local reservation is rolled back if pointer
 * registration fails; TTL is only the bounded crash fallback.
 */
export async function reserveExecutionSlot(
  params: ReserveExecutionSlotParams
): Promise<ReserveExecutionSlotResult> {
  if (!isHosted || !isBillingEnabled) {
    return { reserved: true, created: false }
  }

  const redis = getRedisClient()
  if (!redis) {
    throw new UsageReservationUnavailableError(
      'Usage admission is temporarily unavailable. Please retry.'
    )
  }

  const { billingEntity, plan, member } = params
  const executionId = requireBoundedIdentifier(params.executionId, 'execution id')
  const entityKey = resolveBillingEntityKey(billingEntity)
  if (
    member &&
    (billingEntity.type !== 'organization' || member.organizationId !== billingEntity.id)
  ) {
    throw new UsageReservationUnavailableError(
      'Member usage reservation does not match its organization payer'
    )
  }
  const descriptor = buildDescriptor(entityKey, member)
  const descriptorValue = serializeDescriptor(descriptor)
  const keys = buildLocalKeys(descriptor, executionId)
  const keyArgs = localKeyArguments(keys)
  const pointerKey = `${POINTER_KEY_PREFIX}${executionId}`
  const maxConcurrency = getMaxConcurrentExecutions(plan)
  const currentUsage = requireUsageNumber(params.currentUsage, 'payer current usage')
  const limit = requireUsageNumber(params.limit, 'payer limit')
  const payerHeadroom = Math.max(0, limit - currentUsage)
  const payerBaseChargeSlots = Math.floor(payerHeadroom / RESERVED_BASE_EXECUTION_CHARGE)
  const memberBaseChargeSlots = member
    ? Math.floor(
        Math.max(
          0,
          requireUsageNumber(member.limit, 'member limit') -
            requireUsageNumber(member.currentUsage, 'member current usage')
        ) / RESERVED_BASE_EXECUTION_CHARGE
      )
    : -1
  const ttlMs = getExecutionReservationTtlMs()
  const now = Date.now()
  const expiryScore = now + ttlMs
  let localResult: unknown

  try {
    localResult = await redis.eval(
      RESERVE_SCRIPT,
      keyArgs.length,
      ...keyArgs,
      now.toString(),
      expiryScore.toString(),
      maxConcurrency.toString(),
      payerBaseChargeSlots.toString(),
      executionId,
      descriptorValue,
      expiryScore.toString(),
      memberBaseChargeSlots.toString()
    )
  } catch (error) {
    logger.error('Atomic usage reservation result unavailable — failing closed', {
      error: toError(error).message,
      entityKey,
      executionId,
    })
    throw new UsageReservationUnavailableError(
      'Usage admission is temporarily unavailable. Please retry.',
      error
    )
  }

  if (localResult === RESERVE_PAYER_CONCURRENCY_FULL) {
    return { reserved: false, reason: 'payer_concurrency' }
  }
  if (localResult === RESERVE_PAYER_HEADROOM_FULL) {
    return { reserved: false, reason: 'payer_headroom' }
  }
  if (localResult === RESERVE_MEMBER_HEADROOM_FULL) {
    return { reserved: false, reason: 'member_headroom' }
  }
  if (localResult !== RESERVE_CREATED && localResult !== RESERVE_DUPLICATE) {
    throw new UsageReservationUnavailableError(
      'Usage admission ownership could not be established. Please retry.'
    )
  }

  try {
    const pointerResult = await redis.eval(
      REGISTER_POINTER_SCRIPT,
      1,
      pointerKey,
      descriptorValue,
      expiryScore.toString()
    )
    if (pointerResult === 1 || pointerResult === 2) {
      return { reserved: true, created: localResult === RESERVE_CREATED }
    }
    throw new UsageReservationUnavailableError(
      'Execution id is already reserved by a different payer'
    )
  } catch (error) {
    let pointerState: 'matching' | 'absent' | 'conflicting' | 'unknown' = 'unknown'
    try {
      const pointerValue = await redis.get(pointerKey)
      pointerState =
        pointerValue === descriptorValue
          ? 'matching'
          : pointerValue === null
            ? 'absent'
            : 'conflicting'
    } catch (pointerReadError) {
      logger.error('Unable to verify usage reservation pointer after write failure', {
        entityKey,
        executionId,
        error: toError(pointerReadError).message,
      })
    }
    if (pointerState === 'matching') {
      logger.warn('Usage reservation pointer response unavailable; ownership verified', {
        entityKey,
        executionId,
      })
      return { reserved: true, created: localResult === RESERVE_CREATED }
    }
    const rollbackProven =
      localResult === RESERVE_CREATED &&
      (pointerState === 'absent' || pointerState === 'conflicting')
        ? await rollbackCreatedReservation({
            redis,
            keys,
            executionId,
            descriptorValue,
          })
        : false
    logger.error('Usage reservation pointer registration failed — failing closed', {
      entityKey,
      executionId,
      rollbackProven,
      pointerState,
      duplicateReservation: localResult === RESERVE_DUPLICATE,
      error: toError(error).message,
    })
    throw new UsageReservationUnavailableError(
      rollbackProven
        ? 'Usage admission is temporarily unavailable. Reservation was rolled back; please retry.'
        : 'Usage admission is temporarily unavailable and ownership could not be proven. Please retry.',
      error
    )
  }
}

/**
 * Releases payer and member constraints atomically and idempotently. The
 * pointer is read and conditionally deleted first so local cleanup cannot leave
 * an orphan pointer outside the payer's concurrency bound. TypeScript then
 * declares every payer-slot key to Lua; no script constructs or accesses an
 * undeclared key. A crash between phases leaves only local constraints, still
 * bounded by the payer ceiling and absolute TTL. Paused executions call this
 * only after their pause snapshot is durable.
 */
export async function releaseExecutionSlot(executionId: string): Promise<void> {
  if (!isHosted || !isBillingEnabled) {
    return
  }

  const redis = getRedisClient()
  if (!redis) {
    return
  }

  try {
    const boundedExecutionId = requireBoundedIdentifier(executionId, 'execution id')
    const pointerKey = `${POINTER_KEY_PREFIX}${boundedExecutionId}`
    const descriptorValue = await redis.get(pointerKey)
    if (!descriptorValue) return
    const descriptor = parseDescriptor(descriptorValue)
    if (!descriptor) {
      logger.error('Invalid usage reservation pointer; awaiting TTL cleanup', { executionId })
      return
    }
    try {
      const pointerResult = await redis.eval(DELETE_POINTER_SCRIPT, 1, pointerKey, descriptorValue)
      if (pointerResult !== 1) return
    } catch (pointerError) {
      let pointerDeleted = false
      try {
        pointerDeleted = (await redis.get(pointerKey)) === null
      } catch (pointerReadError) {
        logger.warn('Unable to verify usage reservation pointer deletion', {
          executionId,
          error: toError(pointerReadError).message,
        })
      }
      if (!pointerDeleted) {
        logger.warn('Usage reservation pointer deletion failed; retaining local constraints', {
          executionId,
          error: toError(pointerError).message,
        })
        return
      }
    }
    const keys = buildLocalKeys(descriptor, boundedExecutionId)
    const keyArgs = localKeyArguments(keys)
    const localResult = await redis.eval(
      RELEASE_LOCAL_SCRIPT,
      keyArgs.length,
      ...keyArgs,
      boundedExecutionId,
      descriptorValue
    )
    if (localResult !== 0 && localResult !== 1) {
      logger.error('Usage reservation owner mismatch; awaiting TTL cleanup', { executionId })
      return
    }
  } catch (error) {
    logger.warn('Failed to release usage reservation', {
      error: toError(error).message,
      executionId,
    })
  }
}
