/**
 * Timing contract between Sim and the desktop background executor. The device reads the client
 * side of it from the registration response, so these values can change without a desktop release.
 */

/** Wire version of the executor protocol a device must advertise to be bound to a turn. */
export const DESKTOP_EXECUTOR_PROTOCOL_VERSION = 1

/** A claimed call stays owned for this long without a renewal before it is treated as lost. */
export const DESKTOP_CALL_LEASE_SECONDS = 60

/** How often a device renews the lease of each call it is running. */
export const DESKTOP_CALL_LEASE_RENEW_MS = 20_000

/** How long an offered call waits for its device to claim it before it fails as not started. */
export const DESKTOP_CALL_PICKUP_GRACE_MS = 15_000

/**
 * The device's safety-net inbox pull while it has an active bound run. Shorter than the pickup
 * grace, so a lost doorbell still lets the device claim a call before it fails.
 */
export const DESKTOP_INBOX_ACTIVE_RECONCILE_MS = 10_000

/** The device's safety-net inbox pull while none of its runs are active. */
export const DESKTOP_INBOX_IDLE_RECONCILE_MS = 60_000

/** Presence outlives two missed refreshes, so a rolling deploy does not read as offline. */
export const DESKTOP_PRESENCE_TTL_SECONDS = 45

/** How often a pod serving a device's inbox stream refreshes that device's presence. */
export const DESKTOP_PRESENCE_REFRESH_MS = 15_000

/**
 * Only runs started this recently are scanned for inbox items. A turn, including a terminal
 * handoff, ends well inside it, and the bound keeps the inbox query on a narrow index range.
 */
export const DESKTOP_INBOX_HORIZON_HOURS = 24
