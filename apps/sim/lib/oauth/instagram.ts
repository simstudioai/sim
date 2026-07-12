/** Refresh while the long-lived token still has this many days left. */
export const INSTAGRAM_PROACTIVE_REFRESH_THRESHOLD_DAYS = 14

/**
 * Meta rejects refresh until the long-lived token is at least 24 hours old.
 * @see https://developers.facebook.com/docs/instagram-platform/reference/refresh_access_token/
 */
export const INSTAGRAM_MIN_TOKEN_AGE_MS = 24 * 60 * 60 * 1000

export function isInstagramProvider(providerId: string): boolean {
  return providerId === 'instagram'
}

/**
 * Whether an Instagram long-lived token should be refreshed before it expires.
 * Meta cannot refresh expired tokens, so we must refresh while still valid.
 */
export function shouldProactivelyRefreshInstagramToken(options: {
  accessTokenExpiresAt?: Date | null
  updatedAt?: Date | null
  now?: Date
}): boolean {
  const now = options.now ?? new Date()
  const expiresAt = options.accessTokenExpiresAt
  if (!expiresAt || expiresAt <= now) {
    return false
  }

  const updatedAt = options.updatedAt
  if (updatedAt && now.getTime() - updatedAt.getTime() < INSTAGRAM_MIN_TOKEN_AGE_MS) {
    return false
  }

  const proactiveThreshold = new Date(
    now.getTime() + INSTAGRAM_PROACTIVE_REFRESH_THRESHOLD_DAYS * 24 * 60 * 60 * 1000
  )
  return expiresAt <= proactiveThreshold
}
