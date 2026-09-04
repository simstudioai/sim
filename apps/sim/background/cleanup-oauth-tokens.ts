import { db } from '@sim/db'
import { oauthAccessToken, oauthRefreshToken } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { inArray, lt } from 'drizzle-orm'

const logger = createLogger('CleanupOAuthTokens')

/**
 * How long a lapsed token row is kept before the sweep removes it.
 *
 * Not zero: a short tail keeps the rows readable while a support question about
 * a login that stopped working is still live, and it means clock skew between
 * the app and the database can never delete a token that is in fact current.
 */
export const OAUTH_TOKEN_RETENTION_DAYS = 7

/**
 * Rows removed per table per run, so one sweep cannot hold a long transaction
 * over the busiest tables the provider writes. Whatever is left is collected on
 * the next run.
 */
const OAUTH_TOKEN_SWEEP_LIMIT = 5_000

export interface CleanupOAuthTokensResult {
  refreshTokens: number
  accessTokens: number
}

/**
 * Removes OAuth token rows that expired long enough ago to be of no use.
 *
 * Nothing else deletes them. The provider rotates a refresh token by marking
 * the old row revoked and inserting a new one, and issues a fresh access token
 * every hour without pruning the last — so a single CLI user leaves a dead row
 * behind every hour, forever. Only an explicit revoke deletes anything.
 *
 * Refresh tokens go first and their access tokens follow by cascade
 * (`oauth_access_token.refresh_id`), so the second pass only has to catch
 * access tokens whose refresh token was already gone. Both select a bounded
 * page of ids off the `expires_at` indexes and delete exactly those, rather
 * than issuing an unbounded predicate delete.
 */
export async function runCleanupOAuthTokens(): Promise<CleanupOAuthTokensResult> {
  const cutoff = new Date(Date.now() - OAUTH_TOKEN_RETENTION_DAYS * 24 * 60 * 60 * 1000)

  const staleRefresh = await db
    .select({ id: oauthRefreshToken.id })
    .from(oauthRefreshToken)
    .where(lt(oauthRefreshToken.expiresAt, cutoff))
    .limit(OAUTH_TOKEN_SWEEP_LIMIT)

  if (staleRefresh.length > 0) {
    await db.delete(oauthRefreshToken).where(
      inArray(
        oauthRefreshToken.id,
        staleRefresh.map((row) => row.id)
      )
    )
  }

  const staleAccess = await db
    .select({ id: oauthAccessToken.id })
    .from(oauthAccessToken)
    .where(lt(oauthAccessToken.expiresAt, cutoff))
    .limit(OAUTH_TOKEN_SWEEP_LIMIT)

  if (staleAccess.length > 0) {
    await db.delete(oauthAccessToken).where(
      inArray(
        oauthAccessToken.id,
        staleAccess.map((row) => row.id)
      )
    )
  }

  const result = { refreshTokens: staleRefresh.length, accessTokens: staleAccess.length }
  logger.info('Swept expired OAuth tokens', {
    ...result,
    retentionDays: OAUTH_TOKEN_RETENTION_DAYS,
  })
  return result
}
