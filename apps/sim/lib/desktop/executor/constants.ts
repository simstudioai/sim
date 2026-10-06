/**
 * Timing contract between Sim and the desktop background executor. The device reads the client
 * side of it from the registration response, so these values can change without a desktop release.
 */

/** Wire version of the executor protocol a device must advertise to be bound to a turn. */
export const DESKTOP_EXECUTOR_PROTOCOL_VERSION = 1

/**
 * The device's inbox pull. Short enough that a device whose doorbell was lost still claims a call
 * well inside a pickup window, and that each pull refreshes its presence long before it lapses.
 */
export const DESKTOP_INBOX_RECONCILE_MS = 10_000

/**
 * A device counts as online for this long after its last pull, lease renewal or stream open. It
 * outlives several missed pulls, so a reconnect during a rolling deploy does not read as offline.
 */
export const DESKTOP_PRESENCE_TTL_SECONDS = 45

/**
 * Only runs started this recently are scanned for inbox items. A turn, including a terminal
 * handoff, ends well inside it, and the bound keeps the inbox query on a narrow index range.
 */
export const DESKTOP_INBOX_HORIZON_HOURS = 24
