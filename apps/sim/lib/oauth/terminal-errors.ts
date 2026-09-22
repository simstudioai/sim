import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { getRedisClient } from '@/lib/core/config/redis'

const logger = createLogger('OAuthTerminalErrors')

/** Refresh error codes that no retry can recover from: the credential stays dead until its owner reconnects. */
const TERMINAL_ERRORS = new Set<string>([
  'invalid_refresh_token',
  'bad_refresh_token',
  'invalid_grant',
  'access_denied',
  'bad_client_secret',
  'invalid_client_id',
  'invalid_client',
  'bad_redirect_uri',
  'token_revoked',
])

/**
 * Codes terminal only for the providers listed. Atlassian rejects a revoked or rotated-out
 * refresh token with `unauthorized_client`; elsewhere that code usually describes the app
 * registration, and treating it as terminal would send every credential of the provider to
 * reauthorization over one configuration fault.
 */
const PROVIDER_TERMINAL_ERRORS: Readonly<Record<string, ReadonlySet<string>>> = {
  confluence: new Set(['unauthorized_client']),
  jira: new Set(['unauthorized_client']),
}

const DEAD_CACHE_TTL_SEC = 60 * 60

function deadKey(accountId: string): string {
  return `oauth:dead:${accountId}`
}

export function isTerminalRefreshError(
  code: string | undefined | null,
  providerId?: string
): boolean {
  if (!code) return false
  if (TERMINAL_ERRORS.has(code)) return true
  return providerId !== undefined && (PROVIDER_TERMINAL_ERRORS[providerId]?.has(code) ?? false)
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
