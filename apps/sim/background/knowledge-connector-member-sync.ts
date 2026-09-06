import { createLogger } from '@sim/logger'
import { AbortTaskRunError, task } from '@trigger.dev/sdk'
import {
  assertMemberSyncPayload,
  MEMBER_SYNC_TASK_ID,
  type MemberSyncPayload,
} from '@/lib/knowledge/connectors/member-queue'
import {
  executeMemberSync,
  type MemberSyncResult,
} from '@/lib/knowledge/connectors/member-sync-engine'
import { MEMBER_SYNC_MAX_DURATION_SECONDS } from '@/lib/knowledge/connectors/sync-limits'

const logger = createLogger('TriggerKnowledgeConnectorMemberSync')

export type MemberSyncTaskOutcome = 'completed' | 'partial' | 'skipped' | 'failed'

/** A run is partial when any member or document failed; skipped and failed mirror the content task. */
export function classifyMemberSyncResult(result: MemberSyncResult): MemberSyncTaskOutcome {
  if (result.skipReason) return 'skipped'
  if (result.error) return 'failed'
  if (
    result.listingIncomplete ||
    result.membersIncomplete > 0 ||
    result.membersRemaining ||
    result.membersFailed > 0 ||
    result.docsFailed > 0 ||
    result.processingDispatch.failed > 0
  ) {
    return 'partial'
  }
  return 'completed'
}

export async function executeMemberSyncJob(payload: unknown) {
  const { connectorId, requestId, billingAttribution, dispatchToken, forceContentRefresh } =
    assertMemberSyncPayload(payload)

  logger.info(`[${requestId}] Starting member sync: ${connectorId}`)

  try {
    const result = await executeMemberSync(connectorId, {
      billingAttribution,
      dispatchToken,
      forceContentRefresh,
    })
    const outcome = classifyMemberSyncResult(result)

    logger.info(`[${requestId}] Member sync completed`, {
      connectorId,
      outcome,
      membersClaimed: result.membersClaimed,
      membersCompleted: result.membersCompleted,
      membersIncomplete: result.membersIncomplete,
      membersFailed: result.membersFailed,
      membersRemaining: result.membersRemaining,
      docsListed: result.docsListed,
      added: result.docsAdded,
      updated: result.docsUpdated,
      unchanged: result.docsUnchanged,
      failed: result.docsFailed,
      observationsAdded: result.observationsAdded,
      observationsRemoved: result.observationsRemoved,
      tombstoned: result.docsTombstoned,
      resurrected: result.docsResurrected,
      purged: result.docsPurged,
    })

    if (outcome === 'failed') {
      /**
       * The engine has already written its terminal state and re-armed the
       * connector's failure ladder. Retrying the task would run a second crawl
       * over the same members, so fail visibly without a retry.
       */
      throw new AbortTaskRunError(`Member sync failed for ${connectorId}: ${result.error}`)
    }

    return { success: outcome === 'completed', outcome, connectorId, ...result }
  } catch (error) {
    logger.error(`[${requestId}] Member sync failed: ${connectorId}`, error)
    throw error
  }
}

export const knowledgeConnectorMemberSync = task({
  id: MEMBER_SYNC_TASK_ID,
  maxDuration: MEMBER_SYNC_MAX_DURATION_SECONDS,
  /** Sized like the content sync: a members-mode run hydrates the same documents. */
  machine: 'large-1x',
  /**
   * No retries: the run re-dispatches itself while members remain due, and a
   * crashed run is reclaimed by the scheduler's lease sweep, so a platform
   * retry would only race the replacement.
   */
  retry: { maxAttempts: 1 },
  queue: {
    concurrencyLimit: 5,
    name: 'connector-member-sync-queue',
  },
  run: async (payload: MemberSyncPayload) => executeMemberSyncJob(payload),
})
