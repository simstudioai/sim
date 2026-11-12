/**
 * Readers for the expiry a vendor states for a token it just accepted. Each returns `undefined`
 * for a missing value, an unreadable one, or a calendar date that does not exist, so a caller never
 * records a wrong moment.
 */

/**
 * The UTC moment for a calendar date and time, or `undefined` for one that does not exist (a
 * 30 February, hour 24): `Date` would roll it over into a different, wrong moment.
 */
function calendarMomentUtc(
  [year, month, day, hour = 0, minute = 0, second = 0]: readonly number[],
  offsetMinutes = 0
): Date | undefined {
  const local = new Date(Date.UTC(year, month - 1, day, hour, minute, second))
  if (
    local.getUTCFullYear() !== year ||
    local.getUTCMonth() !== month - 1 ||
    local.getUTCDate() !== day ||
    local.getUTCHours() !== hour ||
    local.getUTCMinutes() !== minute ||
    local.getUTCSeconds() !== second
  ) {
    return undefined
  }
  return new Date(local.getTime() - offsetMinutes * 60_000)
}

/**
 * `2026-12-01 12:30:00 +0200` or `2026-12-01 10:30:00 UTC`. GitHub documents the header but not
 * its value format, so this is parsed strictly by design: the two forms accepted are the ones in
 * the API responses GitHub's own client library records (octokit/octokit.rb spec cassettes), and
 * any other form (including an offset past 23 hours or 59 minutes) is left unread.
 */
const GITHUB_TOKEN_EXPIRATION =
  /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) ([+-](?:[01]\d|2[0-3])[0-5]\d|UTC)$/

/**
 * Reads GitHub's `GitHub-Authentication-Token-Expiration` response header, which GitHub sends on
 * API calls made with a personal access token that has an expiration date, and omits for one that
 * never expires. https://github.blog/changelog/2021-07-26-expiration-options-for-personal-access-tokens/
 */
export function githubTokenExpiration(header: string | null): Date | undefined {
  const match = header ? GITHUB_TOKEN_EXPIRATION.exec(header.trim()) : null
  if (!match) return undefined
  const offset = match[7]
  const offsetMinutes =
    offset === 'UTC'
      ? 0
      : (offset.startsWith('-') ? -1 : 1) *
        (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(3, 5)))
  return calendarMomentUtc(match.slice(1, 7).map(Number), offsetMinutes)
}

/**
 * GitLab's `expires_at` date for a token: it stops working at midnight UTC on that date.
 * https://docs.gitlab.com/user/profile/personal_access_tokens/
 */
export function gitlabTokenExpiration(expiresAt: unknown): Date | undefined {
  const match = typeof expiresAt === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(expiresAt) : null
  return match ? calendarMomentUtc(match.slice(1, 4).map(Number)) : undefined
}

/**
 * A stated expiry for a token the vendor just accepted, when it is still ahead. The acceptance
 * proves the token works now, so a moment already past contradicts the request (a misread value or
 * a skewed clock) and is dropped rather than recorded as fact; an imminent one is kept.
 */
export function credibleTokenExpiry(expiresAt: Date | undefined): Date | undefined {
  if (!expiresAt || Number.isNaN(expiresAt.getTime())) return undefined
  return expiresAt.getTime() > Date.now() ? expiresAt : undefined
}
