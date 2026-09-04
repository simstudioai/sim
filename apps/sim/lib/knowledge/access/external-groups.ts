/**
 * How long a mirrored directory group keeps granting access after its
 * membership was last confirmed.
 *
 * The directory sync never overwrites a membership it failed to read in full,
 * so a transient outage revokes nobody — which is the behaviour we want, and is
 * exactly why an age bound is required. Without one, a sync that stopped
 * running altogether would keep granting indefinitely from membership nobody
 * has checked since.
 *
 * A day is deliberately generous against the sync's own cadence, so a cron
 * outage or a rate-limited directory has room to recover before anyone loses
 * access, while a genuinely abandoned sync stops granting within a day.
 */
export const EXTERNAL_GROUP_STALE_AFTER_MS = 24 * 60 * 60 * 1000

/**
 * How often a workspace's directory groups are re-enumerated.
 *
 * Permissions move faster than content and cost far less to read, so they sync
 * on their own clock rather than riding the content sync. Onyx runs the same
 * split, at the same order of magnitude: five minutes for high-churn sources,
 * thirty for the heavier APIs.
 */
export const EXTERNAL_GROUP_SYNC_INTERVAL_MS = 5 * 60 * 1000

/**
 * How deep nested groups are followed when flattening membership.
 *
 * A directory can nest groups arbitrarily and can contain cycles, so the walk
 * needs both a visited set and a depth bound. Onyx does not recurse at all,
 * which silently drops everyone who is a member only through a subgroup; a
 * bounded walk covers every real directory while still terminating.
 */
export const MAX_GROUP_NESTING_DEPTH = 10
