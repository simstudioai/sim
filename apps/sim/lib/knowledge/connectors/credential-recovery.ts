import { db } from '@sim/db'
import { knowledgeConnector } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import { CREDENTIAL_REVOKED_SYNC_ERROR } from '@/lib/knowledge/connectors/sync-limits'

/**
 * Puts the connectors a reconnected credential had unscheduled back on their schedule.
 *
 * A sync that finds its credential rejected by the source leaves the connector unscheduled
 * with {@link CREDENTIAL_REVOKED_SYNC_ERROR}, since retrying cannot help until someone
 * authorizes again. Reauthorizing the same credential is that moment: every connector still
 * carrying that error is due now, with its failure count cleared. Connectors that were paused
 * or disabled for another reason keep their state, and a connector that already moved on is
 * left alone.
 */
export async function resumeConnectorsAfterCredentialReconnect(
  credentialId: string,
  now: Date
): Promise<void> {
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
        eq(knowledgeConnector.credentialId, credentialId),
        eq(knowledgeConnector.status, 'error'),
        eq(knowledgeConnector.lastSyncError, CREDENTIAL_REVOKED_SYNC_ERROR)
      )
    )
}
