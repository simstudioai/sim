import { db } from '@sim/db'
import { knowledgeConnectorMemberSyncLog, knowledgeConnectorSyncLog } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { describeError } from '@sim/utils/errors'
import { randomInt } from '@sim/utils/random'
import { and, desc, eq, ne } from 'drizzle-orm'
import {
  CONNECTOR_FAILURE_BACKOFF_CAP_MINUTES,
  CONNECTOR_FAILURE_BACKOFF_STEP_MINUTES,
  connectorFailureBackoffMinutes,
} from '@/lib/knowledge/connectors/sync-limits'

const logger = createLogger('ConnectorDatabaseRetry')

/** Jitter added to a database retry, so connectors failed by one slow window do not return together. */
const DATABASE_RETRY_JITTER_MAX_MS = 60_000

/** The streak at which the failure ladder reaches its ceiling; longer streaks back off no further. */
const LADDER_RUNGS = Math.ceil(
  CONNECTOR_FAILURE_BACKOFF_CAP_MINUTES / CONNECTOR_FAILURE_BACKOFF_STEP_MINUTES
)

type SyncRunLog = typeof knowledgeConnectorSyncLog | typeof knowledgeConnectorMemberSyncLog

/** Which run log a sync writes: the content sync's, or the members-mode run's. */
export type SyncRunLogKind = 'content' | 'member'

const RUN_LOGS: Record<SyncRunLogKind, SyncRunLog> = {
  content: knowledgeConnectorSyncLog,
  member: knowledgeConnectorMemberSyncLog,
}

/**
 * How many runs in a row, ending with `runId`, have failed: the run itself plus every failed run
 * before it back to the last one that did not fail, bounded by the ladder's ceiling.
 *
 * A database failure never advances the connector's failure counter, so that a slow database
 * cannot spend the breaker that disables connectors for persistent source failures. The run log
 * already records every attempt, so it measures the streak instead, and a run that keeps failing
 * on a heavy statement still backs off rung by rung. The read uses the log's
 * `(connector_id, started_at DESC)` index. If it fails too, the streak counts only this run and
 * the caller's own floor applies.
 */
export async function countFailedRunStreak(
  kind: SyncRunLogKind,
  connectorId: string,
  runId: string
): Promise<number> {
  const log = RUN_LOGS[kind]
  try {
    const earlier = await db
      .select({ status: log.status })
      .from(log)
      .where(and(eq(log.connectorId, connectorId), ne(log.id, runId)))
      .orderBy(desc(log.startedAt))
      .limit(LADDER_RUNGS - 1)
    const firstSuccess = earlier.findIndex((run) => run.status !== 'failed')
    return 1 + (firstSuccess === -1 ? earlier.length : firstSuccess)
  } catch (error) {
    logger.warn('Could not read the failed-run streak; backing off from this run alone', {
      connectorId,
      kind,
      error: describeError(error),
    })
    return 1
  }
}

/**
 * The delay before retrying a run the database failed: the failure ladder's rung for the longer
 * of the failed-run streak and the breaker's own count, plus jitter.
 */
export function databaseRetryDelayMs(
  failedRunStreak: number,
  previousFailures: number | null | undefined
): number {
  const rung = Math.max(failedRunStreak, (previousFailures ?? 0) + 1)
  return (
    connectorFailureBackoffMinutes(rung) * 60 * 1000 +
    randomInt(0, DATABASE_RETRY_JITTER_MAX_MS + 1)
  )
}
