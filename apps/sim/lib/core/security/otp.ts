import { randomInt } from 'crypto'
import { db } from '@sim/db'
import { verification } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, gt } from 'drizzle-orm'
import { getRedisClient } from '@/lib/core/config/redis'
import type { TokenBucketConfig } from '@/lib/core/rate-limiter'
import { getStorageMethod } from '@/lib/core/storage'

export type DeploymentKind = 'chat' | 'form'

/**
 * Shared OTP configuration for deployment (chat/form) email-auth gates.
 */
export const OTP_EXPIRY_SECONDS = 15 * 60
export const OTP_EXPIRY_MS = OTP_EXPIRY_SECONDS * 1000
export const MAX_OTP_ATTEMPTS = 5

export const OTP_IP_RATE_LIMIT: TokenBucketConfig = {
  maxTokens: 10,
  refillRate: 10,
  refillIntervalMs: 15 * 60_000,
}

export const OTP_EMAIL_RATE_LIMIT: TokenBucketConfig = {
  maxTokens: 3,
  refillRate: 3,
  refillIntervalMs: 15 * 60_000,
}

/**
 * Key formats are kept per-kind to preserve any in-flight OTPs already issued
 * against existing chat deployments. The chat Redis key uses the legacy `otp:`
 * prefix; the chat DB identifier uses `chat-otp:`. Forms use `form-otp:` for
 * both.
 */
const OTP_KEYS = {
  chat: {
    redisKey: (email: string, deploymentId: string) => `otp:${email}:${deploymentId}`,
    dbIdentifier: (email: string, deploymentId: string) => `chat-otp:${deploymentId}:${email}`,
  },
  form: {
    redisKey: (email: string, deploymentId: string) => `form-otp:${email}:${deploymentId}`,
    dbIdentifier: (email: string, deploymentId: string) => `form-otp:${deploymentId}:${email}`,
  },
} as const satisfies Record<
  DeploymentKind,
  {
    redisKey: (email: string, deploymentId: string) => string
    dbIdentifier: (email: string, deploymentId: string) => string
  }
>

/** Returns a cryptographically random 6-digit OTP code. */
export function generateOTP(): string {
  return randomInt(100000, 1000000).toString()
}

/**
 * OTP values are stored as `"code:attempts"` (e.g. `"654321:0"`).
 * This keeps the attempt counter in the same key/row as the OTP itself.
 */
function encodeOTPValue(otp: string, attempts: number): string {
  return `${otp}:${attempts}`
}

export function decodeOTPValue(value: string): { otp: string; attempts: number } {
  const lastColon = value.lastIndexOf(':')
  if (lastColon === -1) return { otp: value, attempts: 0 }
  const attempts = Number.parseInt(value.slice(lastColon + 1), 10)
  return { otp: value.slice(0, lastColon), attempts: Number.isNaN(attempts) ? 0 : attempts }
}

/**
 * Stores an OTP for a deployment+email pair, choosing Redis or the
 * `verification` table based on the configured storage method.
 */
export async function storeOTP(
  kind: DeploymentKind,
  deploymentId: string,
  email: string,
  otp: string
): Promise<void> {
  const keys = OTP_KEYS[kind]
  const value = encodeOTPValue(otp, 0)
  const storageMethod = getStorageMethod()

  if (storageMethod === 'redis') {
    const redis = getRedisClient()
    if (!redis) throw new Error('Redis configured but client unavailable')
    await redis.set(keys.redisKey(email, deploymentId), value, 'EX', OTP_EXPIRY_SECONDS)
    return
  }

  const now = new Date()
  const expiresAt = new Date(now.getTime() + OTP_EXPIRY_MS)
  const identifier = keys.dbIdentifier(email, deploymentId)

  await db.transaction(async (tx) => {
    await tx.delete(verification).where(eq(verification.identifier, identifier))
    await tx.insert(verification).values({
      id: generateId(),
      identifier,
      value,
      expiresAt,
      createdAt: now,
      updatedAt: now,
    })
  })
}

export async function getOTP(
  kind: DeploymentKind,
  deploymentId: string,
  email: string
): Promise<string | null> {
  const keys = OTP_KEYS[kind]
  const storageMethod = getStorageMethod()

  if (storageMethod === 'redis') {
    const redis = getRedisClient()
    if (!redis) throw new Error('Redis configured but client unavailable')
    return redis.get(keys.redisKey(email, deploymentId))
  }

  const now = new Date()
  const [record] = await db
    .select({ value: verification.value })
    .from(verification)
    .where(
      and(
        eq(verification.identifier, keys.dbIdentifier(email, deploymentId)),
        gt(verification.expiresAt, now)
      )
    )
    .limit(1)

  return record?.value ?? null
}

/**
 * Lua script for atomic OTP attempt increment in Redis.
 * Returns `'LOCKED'` if max attempts reached (key deleted), new encoded value
 * otherwise, nil if key missing.
 */
const ATOMIC_INCREMENT_SCRIPT = `
local val = redis.call('GET', KEYS[1])
if not val then return nil end
local colon = val:find(':([^:]*$)')
local otp, attempts
if colon then
  otp = val:sub(1, colon - 1)
  attempts = tonumber(val:sub(colon + 1)) or 0
else
  otp = val
  attempts = 0
end
attempts = attempts + 1
if attempts >= tonumber(ARGV[1]) then
  redis.call('DEL', KEYS[1])
  return 'LOCKED'
end
local newVal = otp .. ':' .. attempts
local ttl = redis.call('TTL', KEYS[1])
if ttl > 0 then
  redis.call('SET', KEYS[1], newVal, 'EX', ttl)
else
  redis.call('SET', KEYS[1], newVal)
end
return newVal
`

/**
 * Atomically increments an OTP's failed-attempt counter. Returns `'locked'`
 * if the max-attempts threshold was reached (and the OTP was deleted), or
 * `'incremented'` otherwise. The DB path uses optimistic locking with retry.
 */
export async function incrementOTPAttempts(
  kind: DeploymentKind,
  deploymentId: string,
  email: string,
  currentValue: string
): Promise<'locked' | 'incremented'> {
  const keys = OTP_KEYS[kind]
  const storageMethod = getStorageMethod()

  if (storageMethod === 'redis') {
    const redis = getRedisClient()
    if (!redis) throw new Error('Redis configured but client unavailable')
    const key = keys.redisKey(email, deploymentId)
    const result = await redis.eval(ATOMIC_INCREMENT_SCRIPT, 1, key, MAX_OTP_ATTEMPTS)
    if (result === null || result === 'LOCKED') return 'locked'
    return 'incremented'
  }

  const identifier = keys.dbIdentifier(email, deploymentId)
  const MAX_RETRIES = 3
  let value = currentValue

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const { otp, attempts } = decodeOTPValue(value)
    const newAttempts = attempts + 1

    if (newAttempts >= MAX_OTP_ATTEMPTS) {
      await db.delete(verification).where(eq(verification.identifier, identifier))
      return 'locked'
    }

    const newValue = encodeOTPValue(otp, newAttempts)
    const updated = await db
      .update(verification)
      .set({ value: newValue, updatedAt: new Date() })
      .where(and(eq(verification.identifier, identifier), eq(verification.value, value)))
      .returning({ id: verification.id })

    if (updated.length > 0) return 'incremented'

    const fresh = await getOTP(kind, deploymentId, email)
    if (!fresh) return 'locked'
    value = fresh
  }

  /**
   * Retry exhaustion under heavy DB-path contention: this request did not
   * succeed in writing its own +1, so the stored count may not reflect it.
   * Fail closed — invalidate the OTP rather than return `'incremented'` with
   * a possibly-undercounted attempt total.
   */
  await db.delete(verification).where(eq(verification.identifier, identifier))
  return 'locked'
}

export async function deleteOTP(
  kind: DeploymentKind,
  deploymentId: string,
  email: string
): Promise<void> {
  const keys = OTP_KEYS[kind]
  const storageMethod = getStorageMethod()

  if (storageMethod === 'redis') {
    const redis = getRedisClient()
    if (!redis) throw new Error('Redis configured but client unavailable')
    await redis.del(keys.redisKey(email, deploymentId))
    return
  }

  await db
    .delete(verification)
    .where(eq(verification.identifier, keys.dbIdentifier(email, deploymentId)))
}
