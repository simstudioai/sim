/** Wall-clock ceiling for one worker; unfinished listings resume from their durable checkpoint. */
export const CONNECTOR_SYNC_MAX_DURATION_SECONDS = 3600

/**
 * Reclaims a run that stopped refreshing its dedicated lease timestamp.
 * Exceeds the worker ceiling; every write also verifies the current lease token.
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

/** Interval between refreshes of the running connector's dedicated lease timestamp. */
export const SYNC_LOCK_HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000

/**
 * Wall-clock ceiling for one members-mode run, which crawls the source once per
 * member. It does not have to cover every member: the run claims members one at
 * a time until {@link MEMBER_SYNC_SOFT_BUDGET_SECONDS} and re-dispatches itself
 * while any remain due, so a large group drains across consecutive runs.
 */
export const MEMBER_SYNC_MAX_DURATION_SECONDS = 3600

/**
 * When a members-mode run stops claiming new members. Leaves headroom below
 * {@link MEMBER_SYNC_MAX_DURATION_SECONDS} for the member in flight to finish
 * its page, write observations, and rematerialise ACLs before the platform
 * kills the run.
 */
export const MEMBER_SYNC_SOFT_BUDGET_SECONDS = 2700

/** Reclaim TTL for a members-mode lease; the same reasoning as {@link CONNECTOR_SYNC_STALE_LOCK_TTL_MS}. */
export const MEMBER_SYNC_STALE_LOCK_TTL_MS = MEMBER_SYNC_MAX_DURATION_SECONDS * 2 * 1000

/** Pages applied per member before its durable feed cursor is saved for continuation. */
export const MEMBER_SYNC_MAX_PAGES_PER_MEMBER = 25

/**
 * Full-listing cadence for connectors without an authoritative change feed;
 * modified timestamps do not capture permission-only changes.
 */
export const MEMBER_FULL_RECRAWL_MINUTES = 720

/**
 * The full-listing cadence for a member whose connector keeps a change feed.
 * The feed reports what they gain, lose, and see modified between listings,
 * so the full listing is only a periodic check that the feed missed nothing.
 */
export const MEMBER_CHANGE_FEED_FULL_RECRAWL_MINUTES = 7 * 24 * 60

/**
 * A member whose crawls have neither started nor completed for this long is
 * treated as gone: their observations are removed and the documents only they
 * observed go dark. Measured against the schedule, not the wall clock, so
 * queue lag in a large group never triggers it.
 */
export const MEMBER_OBSERVATION_STALE_AFTER_HOURS = 24

/**
 * How long a suspended member (credential needs re-auth, enrollment revoked,
 * option disabled) keeps their observations before the row is purged.
 * Suspension already removes their token from every ACL; this window exists so
 * a routine re-auth restores access without re-crawling and re-hydrating.
 */
export const MEMBER_SUSPENDED_PURGE_DAYS = 30

/** Days a members-mode document stays tombstoned with no observer before it is hard deleted. */
export const MEMBER_TOMBSTONE_PURGE_DAYS = 7

/** Hard deletes one members-mode run may perform; bounds the blast radius of a bad run. */
export const MEMBER_PURGE_MAX_PER_RUN = 1000

/** Source downloads are retried by connector listing, never by parsing the retained file again. */
export const SOURCE_CONTENT_ERROR =
  'Source content could not be refreshed. The connector will retry at its next scheduled sync.'
