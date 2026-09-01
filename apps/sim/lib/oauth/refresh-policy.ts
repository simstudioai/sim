import { isInstagramProvider, shouldProactivelyRefreshInstagramToken } from '@/lib/oauth/instagram'
import { isMicrosoftProvider, PROACTIVE_REFRESH_THRESHOLD_DAYS } from '@/lib/oauth/microsoft'

const DAY_MS = 24 * 60 * 60 * 1000

/** Why {@link decideTokenRefresh} reached its verdict. Diagnostic only — never branched on. */
export type RefreshReason =
  | 'valid'
  | 'access-token-missing'
  | 'access-token-expired'
  | 'microsoft-refresh-token-aging'
  | 'instagram-long-lived-aging'

export interface RefreshDecisionInput {
  providerId: string
  hasAccessToken: boolean
  hasRefreshToken: boolean
  accessTokenExpiresAt: Date | null
  refreshTokenExpiresAt: Date | null
  /** Last write to the row. Only Instagram's minimum-token-age gate reads this. */
  updatedAt: Date | null
  now?: Date
}

export interface RefreshDecision {
  shouldRefresh: boolean
  /**
   * True when the stored access token is unusable, so a failed refresh cannot fall back to
   * it. False for a purely proactive refresh, where the caller should reuse what it has.
   */
  accessTokenRequired: boolean
  reason: RefreshReason
}

/**
 * The single staleness rule for OAuth credentials backed by the `account` table. Every
 * resolution path must use it: a caller with its own copy is how Microsoft credentials
 * once slipped past the 90-day inactivity deadline and died.
 */
export function decideTokenRefresh(input: RefreshDecisionInput): RefreshDecision {
  const now = input.now ?? new Date()

  if (!input.hasRefreshToken) {
    return {
      shouldRefresh: false,
      accessTokenRequired: false,
      reason: 'valid',
    }
  }

  if (!input.hasAccessToken) {
    return {
      shouldRefresh: true,
      accessTokenRequired: true,
      reason: 'access-token-missing',
    }
  }

  if (input.accessTokenExpiresAt && input.accessTokenExpiresAt <= now) {
    return {
      shouldRefresh: true,
      accessTokenRequired: true,
      reason: 'access-token-expired',
    }
  }

  /** Microsoft refresh tokens die after 90 days of inactivity; refresh ahead of the window. */
  if (isMicrosoftProvider(input.providerId) && input.refreshTokenExpiresAt) {
    const threshold = new Date(now.getTime() + PROACTIVE_REFRESH_THRESHOLD_DAYS * DAY_MS)
    if (input.refreshTokenExpiresAt <= threshold) {
      return {
        shouldRefresh: true,
        accessTokenRequired: false,
        reason: 'microsoft-refresh-token-aging',
      }
    }
  }

  /** Meta cannot refresh an Instagram long-lived token once it has expired. */
  if (
    isInstagramProvider(input.providerId) &&
    shouldProactivelyRefreshInstagramToken({
      accessTokenExpiresAt: input.accessTokenExpiresAt,
      updatedAt: input.updatedAt,
      now,
    })
  ) {
    return {
      shouldRefresh: true,
      accessTokenRequired: false,
      reason: 'instagram-long-lived-aging',
    }
  }

  return { shouldRefresh: false, accessTokenRequired: false, reason: 'valid' }
}
