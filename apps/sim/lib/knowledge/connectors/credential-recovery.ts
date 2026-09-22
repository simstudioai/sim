import { db } from '@sim/db'
import { account, credential, knowledgeConnector } from '@sim/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import { CREDENTIAL_REVOKED_SYNC_ERROR } from '@/lib/knowledge/connectors/sync-limits'
import { extractSlackTeamId, installationFilter, isSlackProvider } from '@/lib/oauth/slack'

/**
 * Puts the connectors a reconnected account had unscheduled back on their schedule.
 *
 * A sync that finds its credential rejected by the source leaves the connector unscheduled
 * with {@link CREDENTIAL_REVOKED_SYNC_ERROR}, since retrying cannot help until someone
 * authorizes again. Reauthorizing the account is that moment: every connector on a credential
 * of that account still carrying the error is due now, with its failure count cleared. A Slack
 * reauthorization repairs the installation's shared token chain, so the connectors on every
 * credential of the installation's sibling accounts are due as well. Connectors paused or
 * disabled for another reason keep their state, and a connector that already moved on is left
 * alone.
 */
export async function resumeConnectorsAfterCredentialReconnect(
  accountId: string,
  now: Date
): Promise<void> {
  const [reconnected] = await db
    .select({ providerId: account.providerId, providerAccountId: account.accountId })
    .from(account)
    .where(eq(account.id, accountId))
    .limit(1)
  if (!reconnected) return
  const slackTeamId = isSlackProvider(reconnected.providerId)
    ? extractSlackTeamId(reconnected.providerAccountId)
    : null
  const repairedAccounts = slackTeamId
    ? inArray(
        credential.accountId,
        db.select({ id: account.id }).from(account).where(installationFilter(slackTeamId))
      )
    : eq(credential.accountId, accountId)
  await db
    .update(knowledgeConnector)
    .set({
      status: 'active',
      lastSyncError: null,
      consecutiveFailures: 0,
      nextSyncAt: now,
      updatedAt: now,
    })
    .where(
      and(
        inArray(
          knowledgeConnector.credentialId,
          db.select({ id: credential.id }).from(credential).where(repairedAccounts)
        ),
        eq(knowledgeConnector.status, 'error'),
        eq(knowledgeConnector.lastSyncError, CREDENTIAL_REVOKED_SYNC_ERROR)
      )
    )
}
