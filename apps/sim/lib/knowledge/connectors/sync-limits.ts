/**
 * Wall-clock ceiling for a single connector sync run. A large document library
 * needs more than the half hour this used to allow: a 2,600-document site
 * exhausted the old budget and was killed mid-listing, leaving its `syncing`
 * lock set until the scheduler reclaimed it.
 */
export const CONNECTOR_SYNC_MAX_DURATION_SECONDS = 3600

/**
 * How long a connector may sit in `syncing` before the scheduler reclaims its lock.
 *
 * MUST stay above {@link CONNECTOR_SYNC_MAX_DURATION_SECONDS}: reclaiming frees the
 * lock for another sync, so a TTL at or below the run ceiling would start a second
 * sync while the first is still writing, both racing the same documents.
 */
export const CONNECTOR_SYNC_STALE_LOCK_TTL_MS = CONNECTOR_SYNC_MAX_DURATION_SECONDS * 2 * 1000

/**
 * Consecutive failed syncs after which a connector is disabled and stops being
 * scheduled.
 *
 * Shared because two independent writers advance this counter: `executeSync`'s
 * in-process failure path, and the scheduler's out-of-process stale-lock
 * reclaim (a SIGKILL skips `catch`/`finally`, so only the reaper ever sees that
 * failure). A connector that only ever dies hard must still reach the threshold,
 * which it cannot if the two disagree on what the threshold is.
 */
export const MAX_CONSECUTIVE_FAILURES = 10

/** Minutes of backoff added per consecutive failure. */
export const CONNECTOR_FAILURE_BACKOFF_STEP_MINUTES = 30

/** Ceiling on failure backoff — one day, so a recovered source is retried daily. */
export const CONNECTOR_FAILURE_BACKOFF_CAP_MINUTES = 1440

/**
 * Minutes to wait before retrying a connector that has failed `failures` times
 * in a row.
 *
 * Both failure writers must use this ladder. The reaper previously hard-coded a
 * flat 10-minute retry — shorter than any healthy sync interval — so a connector
 * that kept dying hard was retried faster than a healthy one and never backed
 * off at all.
 */
export function connectorFailureBackoffMinutes(failures: number): number {
  return Math.min(
    Math.max(failures, 1) * CONNECTOR_FAILURE_BACKOFF_STEP_MINUTES,
    CONNECTOR_FAILURE_BACKOFF_CAP_MINUTES
  )
}
