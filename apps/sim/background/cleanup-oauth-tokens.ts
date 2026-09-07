import { db } from '@sim/db'
import {
  oauthAccessToken,
  oauthClient,
  oauthConsent,
  oauthTokenFamily,
  session,
  user,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, asc, inArray, lt } from 'drizzle-orm'

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
 * Each family can cascade into 1,001 retained refresh generations. Keep its
 * batch small independently of direct access-token deletion.
 */
const OAUTH_FAMILY_SWEEP_LIMIT = 10
const OAUTH_FAMILY_SWEEP_MAX_PAGES = 5_000
const OAUTH_ACCESS_TOKEN_SWEEP_LIMIT = 5_000
const OAUTH_ACCESS_TOKEN_SWEEP_MAX_PAGES = 10
/** Stops admitting batches before the Helm cron's 60-second request timeout. */
const OAUTH_TOKEN_SWEEP_BUDGET_MS = 45_000

export interface CleanupOAuthTokensResult {
  tokenFamilies: number
  accessTokens: number
}

interface StaleFamilyCandidate {
  id: string
  clientId: string
  sessionId: string | null
  userId: string
  consentId: string | null
}

/** Locks a bounded batch in the same parent-to-child order used by refresh and revocation. */
async function deleteExpiredFamilyBatch(
  staleFamilies: StaleFamilyCandidate[],
  cutoff: Date
): Promise<number> {
  return db.transaction(async (tx) => {
    const userIds = [...new Set(staleFamilies.map((family) => family.userId))]
    const sessionIds = [
      ...new Set(
        staleFamilies
          .map((family) => family.sessionId)
          .filter((sessionId): sessionId is string => sessionId !== null)
      ),
    ]
    const clientIds = [...new Set(staleFamilies.map((family) => family.clientId))]
    const consentIds = [
      ...new Set(
        staleFamilies
          .map((family) => family.consentId)
          .filter((consentId): consentId is string => consentId !== null)
      ),
    ]

    await tx
      .select({ id: user.id })
      .from(user)
      .where(inArray(user.id, userIds))
      .orderBy(asc(user.id))
      .for('share')
    if (sessionIds.length > 0) {
      await tx
        .select({ id: session.id })
        .from(session)
        .where(inArray(session.id, sessionIds))
        .orderBy(asc(session.id))
        .for('share')
    }
    await tx
      .select({ clientId: oauthClient.clientId })
      .from(oauthClient)
      .where(inArray(oauthClient.clientId, clientIds))
      .orderBy(asc(oauthClient.clientId))
      .for('share')
    if (consentIds.length > 0) {
      await tx
        .select({ id: oauthConsent.id })
        .from(oauthConsent)
        .where(inArray(oauthConsent.id, consentIds))
        .orderBy(asc(oauthConsent.id))
        .for('share')
    }

    const familyIds = staleFamilies.map((family) => family.id)
    await tx
      .select({ id: oauthTokenFamily.id })
      .from(oauthTokenFamily)
      .where(and(inArray(oauthTokenFamily.id, familyIds), lt(oauthTokenFamily.expiresAt, cutoff)))
      .orderBy(asc(oauthTokenFamily.id))
      .for('update')
    const deleted = await tx
      .delete(oauthTokenFamily)
      .where(and(inArray(oauthTokenFamily.id, familyIds), lt(oauthTokenFamily.expiresAt, cutoff)))
      .returning({ id: oauthTokenFamily.id })
    return deleted.length
  })
}

/**
 * Removes OAuth login families that expired long enough ago to be of no use.
 *
 * Rotated refresh rows are replay evidence and remain for the lifetime of the
 * bounded family. Removing an old generation by its own expiry would let its
 * later reuse go unnoticed while descendants remained active. The family row
 * therefore owns retention and cascades every generation when it expires.
 *
 * Interleaves family and access-token pages so neither backlog prevents the
 * other from making progress before the deadline. Family deletion cascades its
 * remaining tokens; access pages also catch tokens from still-live families or
 * grants without refresh tokens. Both sweeps retain a 50,000-row run cap while
 * family transactions stay small enough to bound their descendant cascades.
 */
export async function runCleanupOAuthTokens(): Promise<CleanupOAuthTokensResult> {
  const startedAt = Date.now()
  const deadline = startedAt + OAUTH_TOKEN_SWEEP_BUDGET_MS
  const cutoff = new Date(startedAt - OAUTH_TOKEN_RETENTION_DAYS * 24 * 60 * 60 * 1000)
  let tokenFamilies = 0
  let accessTokens = 0
  let moreFamilies = true
  let moreAccessTokens = true

  for (let page = 0; page < OAUTH_FAMILY_SWEEP_MAX_PAGES; page += 1) {
    if (Date.now() >= deadline || (!moreFamilies && !moreAccessTokens)) break

    if (moreFamilies) {
      const staleFamilies = await db
        .select({
          id: oauthTokenFamily.id,
          clientId: oauthTokenFamily.clientId,
          sessionId: oauthTokenFamily.sessionId,
          userId: oauthTokenFamily.userId,
          consentId: oauthTokenFamily.consentId,
        })
        .from(oauthTokenFamily)
        .where(lt(oauthTokenFamily.expiresAt, cutoff))
        .orderBy(asc(oauthTokenFamily.expiresAt), asc(oauthTokenFamily.id))
        .limit(OAUTH_FAMILY_SWEEP_LIMIT)
      if (Date.now() >= deadline) break

      if (staleFamilies.length > 0) {
        tokenFamilies += await deleteExpiredFamilyBatch(staleFamilies, cutoff)
      }
      moreFamilies = staleFamilies.length === OAUTH_FAMILY_SWEEP_LIMIT
    }

    if (Date.now() >= deadline) break
    if (moreAccessTokens && page < OAUTH_ACCESS_TOKEN_SWEEP_MAX_PAGES) {
      const staleAccess = await db
        .select({ id: oauthAccessToken.id })
        .from(oauthAccessToken)
        .where(lt(oauthAccessToken.expiresAt, cutoff))
        .orderBy(asc(oauthAccessToken.expiresAt), asc(oauthAccessToken.id))
        .limit(OAUTH_ACCESS_TOKEN_SWEEP_LIMIT)
      if (Date.now() >= deadline) break

      if (staleAccess.length > 0) {
        const deleted = await db
          .delete(oauthAccessToken)
          .where(
            inArray(
              oauthAccessToken.id,
              staleAccess.map((row) => row.id)
            )
          )
          .returning({ id: oauthAccessToken.id })
        accessTokens += deleted.length
      }
      moreAccessTokens =
        staleAccess.length === OAUTH_ACCESS_TOKEN_SWEEP_LIMIT &&
        page + 1 < OAUTH_ACCESS_TOKEN_SWEEP_MAX_PAGES
    }
  }

  const result = { tokenFamilies, accessTokens }
  logger.info('Swept expired OAuth tokens', {
    ...result,
    retentionDays: OAUTH_TOKEN_RETENTION_DAYS,
    elapsedMs: Date.now() - startedAt,
    deadlineReached: Date.now() >= deadline,
  })
  return result
}
