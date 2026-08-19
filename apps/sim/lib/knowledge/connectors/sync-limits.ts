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
