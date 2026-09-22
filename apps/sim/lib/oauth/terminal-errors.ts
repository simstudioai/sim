import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { getRedisClient } from '@/lib/core/config/redis'

const logger = createLogger('OAuthTerminalErrors')

/**
 * Refresh error codes that say the credential itself is gone: its grant was revoked, expired, or
 * rotated out, and only its owner reconnecting restores it.
 */
const CREDENTIAL_REVOCATION_ERRORS = new Set<string>([
  'invalid_refresh_token',
  'bad_refresh_token',
  'invalid_grant',
  'access_denied',
  'token_revoked',
])

/**
 * Refresh error codes that say our app registration is misconfigured (a rotated client secret,
 * a wrong client id or redirect URI). No retry recovers them either, but the fault is ours and a
 * configuration fix restores every credential of the provider without its owner doing anything.
 */
const APP_CONFIGURATION_ERRORS = new Set<string>([
  'bad_client_secret',
  'invalid_client_id',
  'invalid_client',
  'bad_redirect_uri',
])

/**
 * Credential revocation codes only for the providers listed. Atlassian rejects a revoked or
 * rotated-out refresh token with `unauthorized_client`; elsewhere that code usually describes the
 * app registration, and treating it as terminal would send every credential of the provider to
 * reauthorization over one configuration fault.
 */
const PROVIDER_CREDENTIAL_REVOCATION_ERRORS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['confluence', new Set(['unauthorized_client'])],
  ['jira', new Set(['unauthorized_client'])],
])

const DEAD_CACHE_TTL_SEC = 60 * 60

function deadKey(accountId: string): string {
  return `oauth:dead:${accountId}`
}

/**
 * Whether a refresh error code means the credential's own grant is gone, so that only its owner
 * reconnecting restores it. App-registration faults are terminal for a refresh but not a
 * revocation: fixing the configuration restores the credential with no action from its owner.
 */
export function isCredentialRevocationError(
  code: string | undefined | null,
  providerId?: string
): boolean {
  if (!code) return false
  if (CREDENTIAL_REVOCATION_ERRORS.has(code)) return true
  return (
    providerId !== undefined &&
    (PROVIDER_CREDENTIAL_REVOCATION_ERRORS.get(providerId)?.has(code) ?? false)
  )
}

/** Whether no retry of a refresh can recover from the error code, whoever's fault it is. */
export function isTerminalRefreshError(
  code: string | undefined | null,
  providerId?: string
): boolean {
  if (!code) return false
  return APP_CONFIGURATION_ERRORS.has(code) || isCredentialRevocationError(code, providerId)
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
