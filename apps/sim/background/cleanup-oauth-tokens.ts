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
 * Rows removed per statement. A run drains several bounded pages so routine
 * rotation volume cannot create a permanent backlog, while every delete keeps
 * a predictable lock footprint.
 */
const OAUTH_TOKEN_SWEEP_LIMIT = 5_000
const OAUTH_TOKEN_SWEEP_MAX_PAGES = 10

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
 * Families go first and their refresh/access tokens follow by cascade. The
 * second pass catches expired access tokens for still-live families and access
 * tokens issued without a refresh grant. Both passes use bounded indexed pages.
 */
export async function runCleanupOAuthTokens(): Promise<CleanupOAuthTokensResult> {
  const cutoff = new Date(Date.now() - OAUTH_TOKEN_RETENTION_DAYS * 24 * 60 * 60 * 1000)
  let tokenFamilies = 0
  let accessTokens = 0

  for (let page = 0; page < OAUTH_TOKEN_SWEEP_MAX_PAGES; page += 1) {
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
      .limit(OAUTH_TOKEN_SWEEP_LIMIT)
    if (staleFamilies.length === 0) break

    tokenFamilies += await deleteExpiredFamilyBatch(staleFamilies, cutoff)
    if (staleFamilies.length < OAUTH_TOKEN_SWEEP_LIMIT) break
  }

  for (let page = 0; page < OAUTH_TOKEN_SWEEP_MAX_PAGES; page += 1) {
    const staleAccess = await db
      .select({ id: oauthAccessToken.id })
      .from(oauthAccessToken)
      .where(lt(oauthAccessToken.expiresAt, cutoff))
      .orderBy(asc(oauthAccessToken.expiresAt), asc(oauthAccessToken.id))
      .limit(OAUTH_TOKEN_SWEEP_LIMIT)
    if (staleAccess.length === 0) break

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
    if (staleAccess.length < OAUTH_TOKEN_SWEEP_LIMIT) break
  }

  const result = { tokenFamilies, accessTokens }
  logger.info('Swept expired OAuth tokens', {
    ...result,
    retentionDays: OAUTH_TOKEN_RETENTION_DAYS,
  })
  return result
}
