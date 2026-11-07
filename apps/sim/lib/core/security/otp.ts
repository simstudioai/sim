import { randomInt } from 'crypto'
import { db } from '@sim/db'
import { verification } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, gt, lt, sql } from 'drizzle-orm'
import { getRedisClient } from '@/lib/core/config/redis'
import type { TokenBucketConfig } from '@/lib/core/rate-limiter'
import { getStorageMethod } from '@/lib/core/storage'

export type DeploymentKind = 'chat' | 'file'

/**
 * Shared OTP configuration for deployment email-auth gates (chat + public file shares).
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

/** Caps OTP requests against one deployment independently of client identity. */
export const OTP_RESOURCE_RATE_LIMIT: TokenBucketConfig = {
  maxTokens: 100,
  refillRate: 100,
  refillIntervalMs: 15 * 60_000,
}

/**
 * Key formats are kept per-kind to preserve any in-flight OTPs already issued
 * against existing chat deployments. The chat Redis key uses the legacy `otp:`
 * prefix; the chat DB identifier uses `chat-otp:`.
 */
const OTP_KEYS = {
  chat: {
    redisKey: (email: string, deploymentId: string) => `otp:${email}:${deploymentId}`,
    dbIdentifier: (email: string, deploymentId: string) => `chat-otp:${deploymentId}:${email}`,
  },
  file: {
    redisKey: (email: string, deploymentId: string) => `otp:file:${email}:${deploymentId}`,
    dbIdentifier: (email: string, deploymentId: string) => `file-otp:${deploymentId}:${email}`,
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
 * Lua script that reserves one verification attempt in Redis. Returns the
 * code with the reserved attempt number, or nil when no code exists or every
 * attempt is already spent. The reservation that spends the last attempt
 * deletes the key, so later requests find no code.
 */
const RESERVE_ATTEMPT_SCRIPT = `
local val = redis.call('GET', KEYS[1])
if not val then return nil end
local colon = val:find(':([^:]*)$')
local otp, attempts
if colon then
  otp = val:sub(1, colon - 1)
  attempts = tonumber(val:sub(colon + 1)) or 0
else
  otp = val
  attempts = 0
end
attempts = attempts + 1
local max = tonumber(ARGV[1])
if attempts > max then
  redis.call('DEL', KEYS[1])
  return nil
end
local newVal = otp .. ':' .. attempts
if attempts == max then
  redis.call('DEL', KEYS[1])
else
  local ttl = redis.call('TTL', KEYS[1])
  if ttl > 0 then
    redis.call('SET', KEYS[1], newVal, 'EX', ttl)
  else
    redis.call('SET', KEYS[1], newVal)
  end
end
return newVal
`

/**
 * Atomically spends one of the code's {@link MAX_OTP_ATTEMPTS} attempts and
 * returns the stored code for the caller to compare, or `null` when no live
 * code is left. Reserving before comparing bounds the guesses checked against
 * one code to the attempt limit however many requests run concurrently. The
 * reservation that spends the last attempt also deletes the code.
 */
export async function reserveOTPAttempt(
  kind: DeploymentKind,
  deploymentId: string,
  email: string
): Promise<{ otp: string; attempts: number } | null> {
  const keys = OTP_KEYS[kind]
  const storageMethod = getStorageMethod()

  if (storageMethod === 'redis') {
    const redis = getRedisClient()
    if (!redis) throw new Error('Redis configured but client unavailable')
    const key = keys.redisKey(email, deploymentId)
    const result = await redis.eval(RESERVE_ATTEMPT_SCRIPT, 1, key, MAX_OTP_ATTEMPTS)
    return typeof result === 'string' ? decodeOTPValue(result) : null
  }

  const identifier = keys.dbIdentifier(email, deploymentId)
  // Pattern match, not split + cast: other `verification` rows must never fail a cast.
  const attemptsSql = sql`substring(${verification.value} from ':([0-9]+)$')::int`
  const [reserved] = await db
    .update(verification)
    .set({
      value: sql`substring(${verification.value} from '^(.*):[0-9]+$') || ':' || (${attemptsSql} + 1)`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(verification.identifier, identifier),
        gt(verification.expiresAt, new Date()),
        lt(attemptsSql, MAX_OTP_ATTEMPTS)
      )
    )
    .returning({ value: verification.value })

  if (!reserved) return null
  const decoded = decodeOTPValue(reserved.value)
  if (decoded.attempts >= MAX_OTP_ATTEMPTS) {
    await db
      .delete(verification)
      .where(and(eq(verification.identifier, identifier), eq(verification.value, reserved.value)))
  }
  return decoded
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
