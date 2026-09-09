import { db } from '@sim/db'
import {
  knowledgeBase,
  knowledgeConnector,
  knowledgeConnectorMemberSyncLog,
  knowledgeConnectorSyncLog,
} from '@sim/db/schema'
import { randomInt } from '@sim/utils/random'
import { and, eq, isNull } from 'drizzle-orm'
import { ProviderCapacityDeferredError } from '@/lib/core/rate-limiter/provider-capacity-error'
import type { MemberSyncResult } from '@/lib/knowledge/connectors/member-sync-engine'
import {
  CONNECTOR_FAILURE_BACKOFF_CAP_MINUTES,
  connectorFailureBackoffMinutes,
} from '@/lib/knowledge/connectors/sync-limits'
import { SyncLockLostException, type SyncRunLease } from '@/lib/knowledge/connectors/sync-lock'
import { getRetryAfterMs, isRateLimitError } from '@/lib/knowledge/documents/utils'
import type { SyncResult } from '@/connectors/types'

/** Ordinary capacity pressure must not erase its cause or consume the source failure breaker. */
export function getConnectorSyncDeferral(
  error: unknown
): Omit<NonNullable<SyncResult['deferred']>, 'nextSyncAt'> | undefined {
  if (error instanceof ProviderCapacityDeferredError)
    return { reason: error.reason, providerId: error.providerId }
  if (isRateLimitError(error)) return { reason: 'rate_limit' }
  return undefined
}

/** A durable wait never advances the source watermark or clears an unfinished listing. */
export async function deferConnectorSync(input: {
  connectorId: string
  knowledgeBaseId: string
  runId: string
  lease: SyncRunLease
  kind: 'content' | 'member'
  result: SyncResult | MemberSyncResult
  error: unknown
}): Promise<NonNullable<SyncResult['deferred']>> {
  const deferral = getConnectorSyncDeferral(input.error)
  if (!deferral) throw new Error('Connector sync error is not a provider deferral')
  const now = new Date()
  const fallbackCapMs = CONNECTOR_FAILURE_BACKOFF_CAP_MINUTES * 60_000
  const retryAfterMs =
    getRetryAfterMs(input.error) ??
    Math.min(connectorFailureBackoffMinutes(1) * 60_000, fallbackCapMs)
  /** The scheduler must never shorten an explicit provider cooldown, even beyond its own backoff cap. */
  const jitterMs = Math.min(randomInt(0, 60_001), Math.max(0, fallbackCapMs - retryAfterMs))
  const nextSyncAt = new Date(now.getTime() + retryAfterMs + jitterMs)
  const notice = `Source requests deferred: ${deferral.reason}; retry scheduled for ${nextSyncAt.toISOString()}`
  await db.transaction(async (tx) => {
    const [liveKnowledgeBase] = await tx
      .select({ id: knowledgeBase.id })
      .from(knowledgeBase)
      .where(and(eq(knowledgeBase.id, input.knowledgeBaseId), isNull(knowledgeBase.deletedAt)))
      .for('update')
    if (!liveKnowledgeBase) throw new SyncLockLostException(input.connectorId)
    const [held] = await tx
      .select({ id: knowledgeConnector.id })
      .from(knowledgeConnector)
      .where(input.lease.stillHeld())
      .for('update')
    if (!held) throw new SyncLockLostException(input.connectorId)
    const log =
      input.kind === 'content' ? knowledgeConnectorSyncLog : knowledgeConnectorMemberSyncLog
    const [closed] = await tx
      .update(log)
      .set({
        status: 'partial',
        completedAt: now,
        errorMessage: notice,
        docsAdded: input.result.docsAdded,
        docsUpdated: input.result.docsUpdated,
        docsUnchanged: input.result.docsUnchanged,
        ...('membersClaimed' in input.result
          ? {
              membersClaimed: input.result.membersClaimed,
              membersCompleted: input.result.membersCompleted,
              membersIncomplete: input.result.membersIncomplete,
              membersFailed: input.result.membersFailed,
              docsListed: input.result.docsListed,
              docsHydratedOnce: input.result.docsHydratedOnce,
              observationsAdded: input.result.observationsAdded,
              observationsRemoved: input.result.observationsRemoved,
              docsTombstoned: input.result.docsTombstoned,
              docsResurrected: input.result.docsResurrected,
              docsPurged: input.result.docsPurged,
              credentialsAudited: input.result.credentialsAudited,
            }
          : {}),
        ...(input.kind === 'content'
          ? {
              docsDeleted: input.result.docsDeleted,
              docsSkipped: input.result.docsSkipped,
              docsFailed: input.result.docsFailed,
            }
          : {}),
      })
      .where(and(eq(log.id, input.runId), eq(log.status, 'started')))
      .returning({ id: log.id })
    if (!closed) throw new Error('Connector deferral log no longer belongs to this run')
    const [written] = await tx
      .update(knowledgeConnector)
      .set(
        input.kind === 'content'
          ? {
              status: 'active',
              lastSyncError: notice,
              nextSyncAt,
              syncLockToken: null,
              syncLockLeaseAt: null,
              updatedAt: now,
            }
          : {
              memberSyncStatus: 'idle',
              lastMemberSyncError: notice,
              nextMemberSyncAt: nextSyncAt,
              memberSyncLockToken: null,
              memberSyncLockLeaseAt: null,
              updatedAt: now,
            }
      )
      .where(input.lease.stillHeld())
      .returning({ id: knowledgeConnector.id })
    if (!written) throw new Error('Connector deferral retry no longer belongs to this run')
  })
  return { ...deferral, nextSyncAt: nextSyncAt.toISOString() }
}
