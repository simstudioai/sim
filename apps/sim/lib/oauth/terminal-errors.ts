import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { getRedisClient } from '@/lib/core/config/redis'

const logger = createLogger('OAuthTerminalErrors')

const TERMINAL_ERRORS = new Set<string>([
  'invalid_refresh_token',
  'invalid_grant',
  'access_denied',
  'bad_client_secret',
  'invalid_client_id',
  'invalid_client',
  // Zoho's code for a revoked or otherwise unusable refresh token (it reserves
  // `invalid_client` for a wrong client id/secret). Without this a revoked Zoho
  // credential is never dead-flagged and every execution retries a refresh that
  // can never succeed.
  'invalid_code',
  'bad_redirect_uri',
  'token_revoked',
])

const DEAD_CACHE_TTL_SEC = 60 * 60

function deadKey(accountId: string): string {
  return `oauth:dead:${accountId}`
}

export function isTerminalRefreshError(code: string | undefined | null): boolean {
  if (!code) return false
  return TERMINAL_ERRORS.has(code)
}

export async function markCredentialDead(accountId: string, code: string): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return
  try {
    await redis.set(deadKey(accountId), code, 'EX', DEAD_CACHE_TTL_SEC)
  } catch (error) {
    logger.warn('Failed to mark credential dead in Redis', {
      accountId,
      code,
      error: toError(error).message,
    })
  }
}

export async function getRecentTerminalError(accountId: string): Promise<string | null> {
  const redis = getRedisClient()
  if (!redis) return null
  try {
    return await redis.get(deadKey(accountId))
  } catch (error) {
    logger.warn('Failed to read terminal error flag from Redis', {
      accountId,
      error: toError(error).message,
    })
    return null
  }
}

export async function clearDeadFlag(accountId: string): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return
  try {
    await redis.del(deadKey(accountId))
  } catch (error) {
    logger.warn('Failed to clear terminal error flag from Redis', {
      accountId,
      error: toError(error).message,
    })
  }
}
