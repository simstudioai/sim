import { SOURCE_ACL_MAX_AGE_MS } from '@/lib/knowledge/access/freshness'

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

/** The error a workspace connector carries once its credential is removed; cleared by reconnecting. */
export const CREDENTIAL_REMOVED_SYNC_ERROR =
  'Credential removed. Reconnect the connector to resume syncing.'

/**
 * The error a connector carries once the source rejects its credential outright (a revoked or
 * expired grant, not a passing failure); cleared by reauthorizing that credential.
 */
export const CREDENTIAL_REVOKED_SYNC_ERROR =
  'The source no longer accepts this credential. Reconnect it to resume syncing.'

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

/**
 * Age at which a member's observations are renewed by access scope, for connectors that
 * grant access per container: half the evidence window, so renewal lands well before
 * evidence lapses while touching each observation at most twice a day.
 */
export const MEMBER_SCOPE_RENEW_AFTER_MS = SOURCE_ACL_MAX_AGE_MS / 2

/** How much of a run one member's scope renewal may use before its listing starts. */
export const MEMBER_SCOPE_RENEWAL_BUDGET_MS = 10 * 60 * 1000

/**
 * Container prefixes gathered from the source before one pass over the member's stale
 * observations renews them, so that pass runs once per this many containers rather than
 * once per source page.
 */
export const MEMBER_SCOPE_RENEWAL_PREFIX_BATCH = 5000

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

/**
 * Pages of the connector's documents one members-mode run checks for a document nobody
 * observes, beyond the ones whose observations the run itself removed. The check resumes
 * where the previous run stopped, so a pass over a large connector spans several runs
 * while each run's cost stays independent of the connector's size.
 */
export const MEMBER_TOMBSTONE_RECONCILE_PAGES_PER_RUN = 20

export const SOURCE_PERMISSION_ERROR =
  'Some document permissions could not be verified. Documents without verified access stay hidden from search.'

/** Source downloads are retried by connector listing, never by parsing the retained file again. */
export const SOURCE_CONTENT_ERROR =
  'Source content could not be refreshed. The connector will retry at its next scheduled sync.'

/**
 * Documents whose permission evidence is refreshed per statement. Documents are
 * grouped by identical ACL first — files under one folder overwhelmingly share
 * theirs — so a crawl of thousands usually resolves to a handful of statements.
 * A refresh never assigns `acl`, so it fires no projection fan-out.
 */
export const ACL_WRITE_BATCH_SIZE = 500

/**
 * Search projection rows one statement rewrites per projection table: a page of
 * detachment releases, and the most chunk rows a page of ACL assignments may
 * send through the projection trigger. A page always holds at least one
 * document, so a document larger than this still makes progress alone.
 */
export const PROJECTION_ROW_BATCH_SIZE = 250

/**
 * How long a connector-lease ACL page waits on any lock before it fails. The
 * connector row is locked last, so the wait is on document rows, which a
 * processing commit may hold for its whole embedding write.
 */
export const LEASE_PAGE_LOCK_TIMEOUT_MS = 15_000

/** The longest one statement of a connector-lease ACL page may run. */
export const LEASE_PAGE_STATEMENT_TIMEOUT_MS = 30_000

/**
 * Documents whose ACL actually changes, per statement. Assigning `acl` fires the
 * document trigger that copies it onto every chunk's search projection rows, and
 * each of those rows is re-inserted into the vector index, so one statement costs
 * the chunks of every document in it rather than the documents. Kept small so a
 * page of changed documents cannot outrun the statement timeout. Also the page
 * of the transactions that remove observations and rematerialise the ACLs they
 * decide together, which must commit as one and so cannot be split by rows.
 */
export const ACL_CHANGE_BATCH_SIZE = 25
