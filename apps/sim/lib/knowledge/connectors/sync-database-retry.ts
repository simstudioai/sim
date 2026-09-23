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

/**
 * The retry after a run that failed on the database but moved the sync forward first. Its
 * checkpoint is durable, so the next run resumes rather than repeats, and waiting a ladder rung
 * per failure would crawl a large first sync that hits one slow statement per run.
 */
export const DATABASE_RETRY_AFTER_PROGRESS_MS = 3 * 60 * 1000

/**
 * Failed runs in a row, none of them making progress, at which the retries are reported for
 * alerting. The connector is never disabled for them; this is the signal that it is stuck.
 */
export const DATABASE_FAILURE_ALERT_STREAK = 10

/** The streak at which the failure ladder reaches its ceiling; longer streaks back off no further. */
const LADDER_RUNGS = Math.ceil(
  CONNECTOR_FAILURE_BACKOFF_CAP_MINUTES / CONNECTOR_FAILURE_BACKOFF_STEP_MINUTES
)

/** Which run log a sync writes: the content sync's, or the members-mode run's. */
export type SyncRunLogKind = 'content' | 'member'

interface LoggedRun {
  status: string
  progressed: boolean
}

/** Earlier runs of this connector, newest first, and whether each one moved the sync forward. */
async function readEarlierRuns(
  kind: SyncRunLogKind,
  connectorId: string,
  runId: string,
  limit: number
): Promise<LoggedRun[]> {
  if (kind === 'content') {
    const log = knowledgeConnectorSyncLog
    const rows = await db
      .select({
        status: log.status,
        docsAdded: log.docsAdded,
        docsUpdated: log.docsUpdated,
        docsDeleted: log.docsDeleted,
      })
      .from(log)
      .where(and(eq(log.connectorId, connectorId), ne(log.id, runId)))
      .orderBy(desc(log.startedAt))
      .limit(limit)
    return rows.map((row) => ({
      status: row.status,
      progressed: row.docsAdded + row.docsUpdated + row.docsDeleted > 0,
    }))
  }
  const log = knowledgeConnectorMemberSyncLog
  const rows = await db
    .select({
      status: log.status,
      membersCompleted: log.membersCompleted,
      docsAdded: log.docsAdded,
      docsUpdated: log.docsUpdated,
    })
    .from(log)
    .where(and(eq(log.connectorId, connectorId), ne(log.id, runId)))
    .orderBy(desc(log.startedAt))
    .limit(limit)
  return rows.map((row) => ({
    status: row.status,
    progressed: row.membersCompleted + row.docsAdded + row.docsUpdated > 0,
  }))
}

/**
 * How many runs in a row, ending with `runId`, have failed without moving the sync forward: the
 * run itself plus every such run before it, back to the last run that succeeded or made progress,
 * bounded by the ladder's ceiling.
 *
 * A database failure never advances the connector's failure counter, so that a slow database
 * cannot spend the breaker that disables connectors for persistent source failures. The run log
 * already records every attempt and what it wrote, so it measures the streak instead: a statement
 * that fails every run without progress still backs off rung by rung, while a run that added,
 * updated, or deleted documents (or, in members mode, completed a member) before failing ends it.
 * The read uses the log's `(connector_id, started_at DESC)` index. If it fails too, the streak
 * counts only this run and the caller's own floor applies.
 */
export async function countZeroProgressFailedRuns(
  kind: SyncRunLogKind,
  connectorId: string,
  runId: string
): Promise<number> {
  try {
    const earlier = await readEarlierRuns(kind, connectorId, runId, LADDER_RUNGS - 1)
    const streakEnd = earlier.findIndex((run) => run.status !== 'failed' || run.progressed)
    return 1 + (streakEnd === -1 ? earlier.length : streakEnd)
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
 * The delay before retrying a run the database failed with no progress: the failure ladder's
 * rung for the longer of the zero-progress streak and the breaker's own count, plus jitter.
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

/**
 * When to retry a run that failed on the database. A run that made progress retries after
 * {@link DATABASE_RETRY_AFTER_PROGRESS_MS}; one that made none climbs the ladder by its
 * zero-progress streak and, from {@link DATABASE_FAILURE_ALERT_STREAK} on, reports the streak at
 * error level so a connector stuck on the database is visible without being disabled.
 */
export async function resolveDatabaseRetryDelayMs(retry: {
  kind: SyncRunLogKind
  connectorId: string
  runId: string
  previousFailures: number | null | undefined
  madeProgress: boolean
}): Promise<number> {
  if (retry.madeProgress) {
    return DATABASE_RETRY_AFTER_PROGRESS_MS + randomInt(0, DATABASE_RETRY_JITTER_MAX_MS + 1)
  }
  const streak = await countZeroProgressFailedRuns(retry.kind, retry.connectorId, retry.runId)
  if (streak >= DATABASE_FAILURE_ALERT_STREAK) {
    logger.error('Connector sync keeps failing on the database without progress', {
      connectorId: retry.connectorId,
      kind: retry.kind,
      zeroProgressFailedRuns: streak,
    })
  }
  return databaseRetryDelayMs(streak, retry.previousFailures)
}
