import { randomInt } from 'crypto'
import { safeCompare } from '@sim/security/compare'
import { getRedisClient } from '@/lib/core/config/redis'
import type { TokenBucketConfig } from '@/lib/core/rate-limiter'

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
 * Redis key per deployment kind. The chat key keeps the legacy `otp:` prefix so
 * codes already issued against existing chat deployments stay valid.
 */
const OTP_KEYS = {
  chat: (email: string, deploymentId: string) => `otp:${email}:${deploymentId}`,
  file: (email: string, deploymentId: string) => `otp:file:${email}:${deploymentId}`,
} as const satisfies Record<DeploymentKind, (email: string, deploymentId: string) => string>

/** Returns a cryptographically random 6-digit OTP code. */
export function generateOTP(): string {
  return randomInt(100000, 1000000).toString()
}

/**
 * OTP values are stored as `"code:attempts"` (e.g. `"654321:0"`).
 * This keeps the attempt counter in the same key as the OTP itself.
 */
function encodeOTPValue(otp: string, attempts: number): string {
  return `${otp}:${attempts}`
}

function decodeOTPValue(value: string): { otp: string; attempts: number } {
  const lastColon = value.lastIndexOf(':')
  if (lastColon === -1) return { otp: value, attempts: 0 }
  const attempts = Number.parseInt(value.slice(lastColon + 1), 10)
  return { otp: value.slice(0, lastColon), attempts: Number.isNaN(attempts) ? 0 : attempts }
}

/** Stores an OTP for a deployment+email pair in Redis, replacing any previous code. */
export async function storeOTP(
  kind: DeploymentKind,
  deploymentId: string,
  email: string,
  otp: string
): Promise<void> {
  const redis = getRedisClient()
  await redis.set(
    OTP_KEYS[kind](email, deploymentId),
    encodeOTPValue(otp, 0),
    'EX',
    OTP_EXPIRY_SECONDS
  )
}

/**
 * Lua script that reserves one verification attempt in Redis. Returns the
 * code with the reserved attempt number, or nil when no code exists or its
 * attempts are spent. Rewrites keep the remaining lifetime to the
 * millisecond; a code without one is treated as expired so it can never
 * become permanent.
 */
const RESERVE_ATTEMPT_SCRIPT = `
local val = redis.call('GET', KEYS[1])
if not val then return nil end
local otp, attempts = val:match('^(.*):(%d+)$')
if not otp then return nil end
local ttl = redis.call('PTTL', KEYS[1])
if ttl <= 0 then
  redis.call('DEL', KEYS[1])
  return nil
end
attempts = tonumber(attempts)
if attempts >= tonumber(ARGV[1]) then return nil end
local newVal = otp .. ':' .. (attempts + 1)
redis.call('SET', KEYS[1], newVal, 'PX', ttl)
return newVal
`

/**
 * Lua script that deletes the key only while it still holds the code in
 * ARGV[1], returning 1 when this call removed it.
 */
const CONSUME_SCRIPT = `
local val = redis.call('GET', KEYS[1])
if not val or val:match('^(.*):%d+$') ~= ARGV[1] then return 0 end
return redis.call('DEL', KEYS[1])
`

/**
 * Atomically spends one of the code's {@link MAX_OTP_ATTEMPTS} attempts and
 * returns the stored code with its reserved attempt count, or `null` when no
 * live code is left or all its attempts are spent.
 */
async function reserveOTPAttempt(
  kind: DeploymentKind,
  deploymentId: string,
  email: string
): Promise<{ otp: string; attempts: number } | null> {
  const redis = getRedisClient()
  const key = OTP_KEYS[kind](email, deploymentId)
  const result = await redis.eval(RESERVE_ATTEMPT_SCRIPT, 1, key, MAX_OTP_ATTEMPTS)
  return typeof result === 'string' ? decodeOTPValue(result) : null
}

export type OTPVerification = 'valid' | 'invalid' | 'locked' | 'missing'

/**
 * Checks a submitted code and consumes it on a match. An attempt is reserved
 * before the comparison, so at most {@link MAX_OTP_ATTEMPTS} guesses are ever
 * compared against one code however many requests run concurrently, and only
 * one correct submission succeeds. `'locked'` means this guess spent the last
 * attempt and the code is gone; `'missing'` covers a code that is gone or was
 * consumed by a concurrent request.
 */
export async function verifyOTP(
  kind: DeploymentKind,
  deploymentId: string,
  email: string,
  code: string
): Promise<OTPVerification> {
  const reserved = await reserveOTPAttempt(kind, deploymentId, email)
  if (!reserved) return 'missing'
  if (safeCompare(reserved.otp, code)) {
    return (await consumeOTP(kind, deploymentId, email, reserved.otp)) ? 'valid' : 'missing'
  }
  if (reserved.attempts < MAX_OTP_ATTEMPTS) return 'invalid'
  await consumeOTP(kind, deploymentId, email, reserved.otp)
  return 'locked'
}

/**
 * Deletes the stored code only if it is still `otp`, so concurrent correct
 * submissions get one success between them and a newer code issued meanwhile
 * survives. Returns whether this call removed it.
 */
async function consumeOTP(
  kind: DeploymentKind,
  deploymentId: string,
  email: string,
  otp: string
): Promise<boolean> {
  const redis = getRedisClient()
  const key = OTP_KEYS[kind](email, deploymentId)
  return (await redis.eval(CONSUME_SCRIPT, 1, key, otp)) === 1
}
