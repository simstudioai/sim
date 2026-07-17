import { db } from '@sim/db'
import { account } from '@sim/db/schema'
import { and, eq, gt, isNotNull, like, max, sql } from 'drizzle-orm'

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

interface FanOutOptions {
  /**
   * Version guard: skip the write entirely when any sibling row was updated
   * after this timestamp. A refresh leader holds its chain snapshot across a
   * multi-second provider call while a concurrent OAuth connect (whose
   * `account.create.after` fan-out takes no lock) may land the newly issued
   * chain first — an unconditional write would then overwrite the live chain
   * with a stale one. Omit for connect-time fan-out, whose chain is by
   * definition the newest.
   */
  ifChainUnchangedSince?: Date
}

/**
 * Writes a token chain to every account row of a Slack installation. Rotation
 * revokes whatever the sibling rows were holding, so a successful refresh or a
 * fresh connect must overwrite all copies or the stale ones fail with
 * `token_revoked` at call time.
 */
export async function fanOutSlackTokenChain(
  teamId: string,
  chain: SlackTokenChain,
  options?: FanOutOptions
): Promise<void> {
  const since = options?.ifChainUnchangedSince
  await db
    .update(account)
    .set({
      accessToken: chain.accessToken,
      accessTokenExpiresAt: chain.accessTokenExpiresAt,
      ...(chain.refreshToken ? { refreshToken: chain.refreshToken } : {}),
      updatedAt: new Date(),
    })
    .where(
      and(
        installationFilter(teamId),
        since
          ? sql`NOT EXISTS (SELECT 1 FROM ${account} sibling WHERE sibling.provider_id = 'slack' AND sibling.account_id LIKE ${`${teamId}-%`} AND sibling.updated_at > ${since})`
          : undefined
      )
    )
}

/**
 * True when any account row of the installation was updated after `since` —
 * i.e. another writer (a fresh connect or a competing refresh) landed a newer
 * chain while the caller was working from an older snapshot.
 */
export async function hasSlackChainMoved(teamId: string, since: Date): Promise<boolean> {
  const [row] = await db
    .select({ moved: max(account.updatedAt) })
    .from(account)
    .where(and(installationFilter(teamId), gt(account.updatedAt, since)))
    .limit(1)
  return row?.moved != null
}

interface FreshestSlackChain {
  accessToken: string | null
  refreshToken: string
  accessTokenExpiresAt: Date | null
  /**
   * Max `updated_at` across the installation's rows at read time — the version
   * guard passed back into {@link fanOutSlackTokenChain} / consulted via
   * {@link hasSlackChainMoved} after the provider round-trip.
   */
  chainVersion: Date
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
      chainVersion: sql<
        Date | string | null
      >`(SELECT max(sibling.updated_at) FROM ${account} sibling WHERE sibling.provider_id = 'slack' AND sibling.account_id LIKE ${`${teamId}-%`})`,
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
    chainVersion: row.chainVersion ? new Date(row.chainVersion) : new Date(0),
  }
}
