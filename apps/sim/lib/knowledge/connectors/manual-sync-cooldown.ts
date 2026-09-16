import type { db } from '@sim/db'
import {
  knowledgeConnector,
  knowledgeConnectorMemberSyncLog,
  knowledgeConnectorSyncLog,
} from '@sim/db/schema'
import { desc, eq } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'

const MANUAL_SYNC_COOLDOWN_MS = 60_000

/**
 * Called inside the pending-claim transaction. The connector lock is also held
 * when a run completes, so its latest verdict cannot change before admission.
 */
export async function assertManualSyncCooldown(
  tx: Pick<typeof db, 'select'>,
  connectorId: string,
  kind: 'content' | 'member'
): Promise<void> {
  const [connector] = await tx
    .select({
      status: knowledgeConnector.status,
      memberSyncStatus: knowledgeConnector.memberSyncStatus,
      lastSyncError: knowledgeConnector.lastSyncError,
      lastMemberSyncError: knowledgeConnector.lastMemberSyncError,
    })
    .from(knowledgeConnector)
    .where(eq(knowledgeConnector.id, connectorId))
    .for('update')
    .limit(1)

  if (
    !connector ||
    connector.status !== 'active' ||
    (kind === 'member'
      ? connector.memberSyncStatus !== 'idle' || connector.lastMemberSyncError
      : connector.lastSyncError)
  )
    return

  const log = kind === 'content' ? knowledgeConnectorSyncLog : knowledgeConnectorMemberSyncLog
  const [latest] = await tx
    .select({
      status: log.status,
      completedAt: log.completedAt,
      failures:
        kind === 'content'
          ? knowledgeConnectorSyncLog.docsFailed
          : knowledgeConnectorMemberSyncLog.membersFailed,
    })
    .from(log)
    .where(eq(log.connectorId, connectorId))
    .orderBy(desc(log.startedAt))
    .limit(1)

  if (latest?.status !== 'completed' || !latest.completedAt || latest.failures > 0) return
  const remainingMs = latest.completedAt.getTime() + MANUAL_SYNC_COOLDOWN_MS - Date.now()
  if (remainingMs > 0)
    throw new OrchestrationError(
      'conflict',
      `Sync finished recently. Try again in ${Math.ceil(remainingMs / 1000)} seconds.`
    )
}
