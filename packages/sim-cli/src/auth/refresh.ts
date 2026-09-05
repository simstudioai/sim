import {
  type ResolvedProfile,
  readCredentialsProfile,
  readStoredOAuth,
  type StoredOAuthCredential,
  withCredentialsLock,
  writeCredentialsProfile,
} from '../config/index'
import { SimApiError } from '../http/client'
import { OAuthTokenError, refreshTokens } from './oauth-flow'

/**
 * Bounded well under the credentials lock's stale window: a hung authorization
 * server must not hold the lock long enough for another process to reclaim it
 * and race the same single-use refresh token.
 */
const REFRESH_TIMEOUT_MS = 10 * 1000

/**
 * Renews a stored OAuth login and persists the rotated pair.
 *
 * Under the credentials lock because the refresh token is single-use and two
 * local processes must not race it. After taking the lock the file is read
 * again: if another process already rotated the token, its result is adopted
 * and no request is made. This coordinates trusted local processes; detecting
 * and containing a copied token remains the authorization server's job.
 *
 * `invalid_grant` means the server no longer honours the refresh token — it
 * was revoked from Settings → Authorized apps, expired, or was already rotated
 * by a process this one could not see — and the remedy is logout followed by a
 * new login.
 */
export async function refreshStoredOAuth(
  profile: Pick<ResolvedProfile, 'name' | 'endpoint' | 'authProfile'>,
  current: StoredOAuthCredential
): Promise<StoredOAuthCredential> {
  return withCredentialsLock(async () => {
    const stored = readStoredOAuth(readCredentialsProfile(profile.authProfile))
    if (!stored || stored.loginId !== current.loginId) {
      throw new SimApiError(
        `The stored login changed while this command was waiting to refresh it. Retry the command with the active login for profile ${profile.authProfile}.`,
        401
      )
    }
    if (stored.refreshToken !== current.refreshToken) return stored

    let tokens: StoredOAuthCredential
    try {
      const refreshed = await refreshTokens(
        profile.endpoint,
        current.refreshToken,
        current.scope.split(' ').filter(Boolean),
        AbortSignal.timeout(REFRESH_TIMEOUT_MS)
      )
      tokens = {
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        expiresAt: refreshed.expiresAt,
        issuer: current.issuer,
        loginId: current.loginId,
        scope: refreshed.scope,
      }
    } catch (error) {
      if (error instanceof OAuthTokenError && error.oauthError === 'invalid_grant') {
        throw new SimApiError(
          `Your Sim login expired, was revoked, or detected refresh-token reuse. Run sim logout --profile ${profile.authProfile}, then sim login --profile ${profile.authProfile}.`,
          401
        )
      }
      throw error
    }

    writeCredentialsProfile(profile.authProfile, { kind: 'oauth', oauth: tokens })
    return tokens
  })
}
