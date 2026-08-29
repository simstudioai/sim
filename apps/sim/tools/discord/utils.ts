/**
 * Whether an optional Discord tool param was supplied.
 *
 * This exists instead of `params.x?.trim()`. Tool params are declared
 * `type: 'string'`, but nothing enforces that before the value reaches a URL
 * builder: an LLM tool call can deliver a snowflake as a JSON **number**, and
 * stored workflow state can too. Calling `.trim()` on one throws a bare
 * `TypeError: params.userId?.trim is not a function` — naming neither the tool
 * nor the parameter — and it throws *before* `safeUrlPathSegment` runs, so the
 * number and bigint support that helper deliberately provides never applies.
 *
 * Presence is therefore tested without assuming the value is a string, and the
 * raw value is handed to `safeUrlPathSegment`, which owns every kind check and
 * reports a named error for the shapes it refuses.
 *
 * A blank or whitespace-only string counts as absent, matching the `?.trim()`
 * truthiness test this replaces, so an omitted param still selects the same
 * branch it always did.
 */
export function isProvidedParam<T>(value: T): value is NonNullable<T> {
  if (value === null || value === undefined) return false
  if (typeof value === 'string') return value.trim() !== ''
  return true
}
