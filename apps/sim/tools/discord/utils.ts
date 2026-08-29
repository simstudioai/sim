import { safeUrlPathSegment } from '@/tools/url-path'

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

/**
 * Builds a path segment for a Discord `{user.id}` slot, preserving the
 * documented `@me` alias.
 *
 * Discord publishes `@me` as a literal route segment standing in for the
 * current bot — `GET /users/@me`, `DELETE .../reactions/{emoji}/@me`, and
 * `PATCH /guilds/{guild.id}/members/@me`. Before these guards existed the value
 * was interpolated raw, so a user who typed `@me` into a user-ID field got a
 * working request. `encodeURIComponent('@me')` is `%40me`, which Discord does
 * not route, so encoding it silently turned those calls into 404s.
 *
 * `@me` is passed through verbatim because it is traversal-inert: it is
 * neither a dot segment nor does it contain `/` or `\`, so it cannot pop or
 * add a path segment. Everything else goes through `safeUrlPathSegment`
 * unchanged, so this widens the accepted set by exactly one constant and
 * weakens nothing.
 */
export function discordUserPathSegment(value: unknown, paramName: string): string {
  if (typeof value === 'string' && value.trim() === '@me') {
    return '@me'
  }
  return safeUrlPathSegment(value as string | number | bigint, paramName)
}
