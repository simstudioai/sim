/**
 * Wall-clock ceiling for a single connector sync run.
 *
 * Raised from the half hour this used to allow, which a large document library
 * exhausted mid-listing: the run was killed partway through pagination, leaving
 * its `syncing` lock set until the scheduler reclaimed it. Listing dominates a
 * large sync's wall clock, so the ceiling has to cover a full enumeration rather
 * than a typical one.
 */
export const CONNECTOR_SYNC_MAX_DURATION_SECONDS = 3600

/**
 * How long a connector may sit in `syncing` before the scheduler reclaims its lock.
 *
 * MUST stay above {@link CONNECTOR_SYNC_MAX_DURATION_SECONDS}: reclaiming frees the
 * lock for another sync, so a TTL at or below the run ceiling would start a second
 * sync while the first is still writing, both racing the same documents.
 *
 * Measured against `COALESCE(syncLockLeaseAt, updatedAt)`, the lease a running
 * sync refreshes every {@link SYNC_LOCK_HEARTBEAT_INTERVAL_MS}. The lease is a
 * dedicated column precisely so an unrelated write to the row — a config edit on
 * a wedged connector — can no longer pass for a heartbeat; `updatedAt` remains
 * only as the fallback for a row locked before that column existed. That is what makes the TTL mean
 * "nobody is working on this" rather than "this started a long time ago" — the
 * distinction the in-process fallback path needs. A Trigger.dev run is killed at
 * {@link CONNECTOR_SYNC_MAX_DURATION_SECONDS} and so is provably dead well before
 * this; the fallback path has no duration cap, so without a heartbeat a large
 * self-hosted sync that legitimately runs past two hours would be reclaimed while
 * still working, counted as a failure, and — because its own terminal write is
 * then rejected as superseded — never able to reset that counter. Ten such syncs
 * would disable a connector whose every sync had actually succeeded.
 *
 * A run that stops heartbeating is genuinely gone: its process died, or it is
 * wedged, and either way reclaiming it is correct. The sweep's verdict stays
 * authoritative for those — `completeSyncLog` is guarded on `status = 'started'`
 * and terminal connector writes on the run's own `syncLockToken`, so a late
 * finisher loses the race by design rather than by accident.
 */
export const CONNECTOR_SYNC_STALE_LOCK_TTL_MS = CONNECTOR_SYNC_MAX_DURATION_SECONDS * 2 * 1000

/**
 * Consecutive failed syncs after which a connector is disabled and stops being
 * scheduled.
 *
 * Shared because two independent writers advance this counter: `executeSync`'s
 * in-process failure path, and the scheduler's out-of-process stale-lock
 * reclaim (a SIGKILL unwinds nothing, so the in-process `catch` never runs and
 * only the reaper ever sees that failure). A connector that only ever dies hard must still reach the threshold,
 * which it cannot if the two disagree on what the threshold is.
 */
export const MAX_CONSECUTIVE_FAILURES = 10

/**
 * The error a connector carries once {@link MAX_CONSECUTIVE_FAILURES} disables it.
 *
 * Shared by the same two writers as the threshold itself. Reporting a timeout on
 * a run that was actually auto-disabled tells the operator to wait for a retry
 * that {@link MAX_CONSECUTIVE_FAILURES} has already cancelled.
 */
export const CONNECTOR_AUTO_DISABLED_ERROR =
  'Connector disabled after repeated sync failures. Please reconnect.'

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

/**
 * How often a running sync refreshes its connector's `updatedAt` to prove it is
 * still working.
 *
 * MUST stay well below {@link CONNECTOR_SYNC_STALE_LOCK_TTL_MS} so ordinary
 * jitter — a slow batch, a long upload — cannot let a live run drift past the
 * reclaim cutoff. The cost is one narrow UPDATE per interval per running sync,
 * negligible against the work a sync does between beats.
 */
export const SYNC_LOCK_HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000
