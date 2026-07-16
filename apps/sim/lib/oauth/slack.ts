import { db } from '@sim/db'
import { account } from '@sim/db/schema'
import { and, eq, isNotNull, like, sql } from 'drizzle-orm'

/**
 * Slack bot tokens belong to the installation (team × app), not to the OAuth
 * grant: every connect of the same Slack workspace hands back the same rotating
 * token chain, so all `account` rows for one team are copies of one credential.
 * These helpers let the refresh path treat those rows as a single unit.
 *
 * External account ids are `${teamId}-${userSegment}-${uuid}` (see the Slack
 * getUserInfo in lib/auth/auth.ts). The team segment charset `[TE][A-Z0-9]+`
 * contains no LIKE metacharacters, and the trailing `-` in the prefix match
 * prevents `T123` from matching `T1234-...`.
 */
const SLACK_TEAM_PREFIX_RE = /^([TE][A-Z0-9]+)-/

export function isSlackProvider(providerId: string): boolean {
  return providerId === 'slack'
}

/**
 * Extracts the Slack installation (team/enterprise) id from an external account
 * id. Returns null for ids that don't carry a team prefix (e.g. legacy pasted
 * `slack-bot-...` rows), which keep per-row refresh behavior.
 */
export function extractSlackTeamId(externalAccountId: string | null | undefined): string | null {
  if (!externalAccountId) return null
  const match = SLACK_TEAM_PREFIX_RE.exec(externalAccountId)
  return match ? match[1] : null
}

function installationFilter(teamId: string) {
  return and(eq(account.providerId, 'slack'), like(account.accountId, `${teamId}-%`))
}

interface SlackTokenChain {
  accessToken: string
  refreshToken: string | null
  accessTokenExpiresAt: Date | null
}

/**
 * Writes a token chain to every account row of a Slack installation. Rotation
 * revokes whatever the sibling rows were holding, so a successful refresh or a
 * fresh connect must overwrite all copies or the stale ones fail with
 * `token_revoked` at call time.
 */
export async function fanOutSlackTokenChain(teamId: string, chain: SlackTokenChain): Promise<void> {
  await db
    .update(account)
    .set({
      accessToken: chain.accessToken,
      accessTokenExpiresAt: chain.accessTokenExpiresAt,
      ...(chain.refreshToken ? { refreshToken: chain.refreshToken } : {}),
      updatedAt: new Date(),
    })
    .where(installationFilter(teamId))
}

interface FreshestSlackChain {
  accessToken: string | null
  refreshToken: string
  accessTokenExpiresAt: Date | null
}

/**
 * Reads the freshest token chain for an installation: the sibling row with the
 * latest access-token expiry that still holds a refresh token. The caller's own
 * copy may already be rotated away; the installation's live refresh token is
 * the most recently issued one.
 */
export async function getFreshestSlackChain(teamId: string): Promise<FreshestSlackChain | null> {
  const [row] = await db
    .select({
      accessToken: account.accessToken,
      refreshToken: account.refreshToken,
      accessTokenExpiresAt: account.accessTokenExpiresAt,
    })
    .from(account)
    .where(and(installationFilter(teamId), isNotNull(account.refreshToken)))
    .orderBy(sql`${account.accessTokenExpiresAt} DESC NULLS LAST`)
    .limit(1)

  if (!row?.refreshToken) return null
  return {
    accessToken: row.accessToken,
    refreshToken: row.refreshToken,
    accessTokenExpiresAt: row.accessTokenExpiresAt,
  }
}
