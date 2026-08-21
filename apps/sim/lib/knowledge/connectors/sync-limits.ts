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
 *
 * This is a hard ceiling for BOTH execution paths, not just the queued one. A
 * Trigger.dev run is killed at {@link CONNECTOR_SYNC_MAX_DURATION_SECONDS}, so it
 * is provably dead well before this. The fallback path is not: when Trigger.dev is
 * unavailable, `dispatchSync` runs `executeSync` fire-and-forget inside the web
 * process with no duration cap, and such a run genuinely can still be executing
 * when this TTL expires.
 *
 * Treating it as dead anyway is deliberate. An unbounded background sync in a
 * recyclable web process that has run for two hours is indistinguishable from one
 * whose process was recycled out from under it, and the cost of guessing wrong in
 * the other direction is a connector locked out of syncing forever. The sweep's
 * verdict is therefore authoritative: `completeSyncLog` is guarded on
 * `status = 'started'`, so a late finisher cannot overwrite a row already closed
 * here, and it loses the race by design rather than by accident.
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
