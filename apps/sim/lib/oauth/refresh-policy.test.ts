/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { decideTokenRefresh, type RefreshDecisionInput } from '@/lib/oauth/refresh-policy'

const NOW = new Date('2026-08-28T12:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000

function input(overrides: Partial<RefreshDecisionInput> = {}): RefreshDecisionInput {
  return {
    providerId: 'google-drive',
    hasAccessToken: true,
    hasRefreshToken: true,
    accessTokenExpiresAt: new Date(NOW.getTime() + DAY_MS),
    refreshTokenExpiresAt: null,
    updatedAt: new Date(NOW.getTime() - 30 * DAY_MS),
    now: NOW,
    ...overrides,
  }
}

describe('decideTokenRefresh', () => {
  it('leaves a valid token alone', () => {
    expect(decideTokenRefresh(input())).toEqual({
      shouldRefresh: false,
      accessTokenRequired: false,
      reason: 'valid',
    })
  })

  it('never refreshes without a refresh token, however stale the access token', () => {
    expect(
      decideTokenRefresh(
        input({
          hasRefreshToken: false,
          hasAccessToken: false,
          accessTokenExpiresAt: new Date(NOW.getTime() - DAY_MS),
        })
      )
    ).toEqual({ shouldRefresh: false, accessTokenRequired: false, reason: 'valid' })
  })

  it('treats a null expiry on a present access token as valid', () => {
    expect(decideTokenRefresh(input({ accessTokenExpiresAt: null }))).toMatchObject({
      shouldRefresh: false,
      reason: 'valid',
    })
  })

  it('refreshes when the access token is missing', () => {
    expect(decideTokenRefresh(input({ hasAccessToken: false }))).toEqual({
      shouldRefresh: true,
      accessTokenRequired: true,
      reason: 'access-token-missing',
    })
  })

  it('refreshes when the access token has expired', () => {
    expect(
      decideTokenRefresh(input({ accessTokenExpiresAt: new Date(NOW.getTime() - 1) }))
    ).toEqual({
      shouldRefresh: true,
      accessTokenRequired: true,
      reason: 'access-token-expired',
    })
  })

  /**
   * `getOAuthToken` previously used `<`, so a token expiring exactly at `now` was
   * treated as live and shipped to the provider a moment before it died.
   */
  it('refreshes a token expiring exactly now', () => {
    expect(decideTokenRefresh(input({ accessTokenExpiresAt: NOW }))).toMatchObject({
      shouldRefresh: true,
      reason: 'access-token-expired',
    })
  })

  describe('Microsoft refresh-token aging', () => {
    const microsoft = (refreshTokenExpiresAt: Date | null) =>
      decideTokenRefresh(input({ providerId: 'outlook', refreshTokenExpiresAt }))

    it('proactively refreshes inside the 7-day window without requiring a new access token', () => {
      expect(microsoft(new Date(NOW.getTime() + 6 * DAY_MS))).toEqual({
        shouldRefresh: true,
        accessTokenRequired: false,
        reason: 'microsoft-refresh-token-aging',
      })
    })

    it('leaves a refresh token outside the window alone', () => {
      expect(microsoft(new Date(NOW.getTime() + 30 * DAY_MS))).toMatchObject({
        shouldRefresh: false,
        reason: 'valid',
      })
    })

    it('does nothing when the refresh-token expiry is unknown', () => {
      expect(microsoft(null)).toMatchObject({ shouldRefresh: false, reason: 'valid' })
    })

    /**
     * The delta this consolidation intentionally introduces: `getOAuthToken` omitted
     * this arm, so Microsoft credentials reached only through it could pass the 90-day
     * inactivity deadline and die permanently.
     */
    it('applies to a non-Microsoft provider not at all', () => {
      expect(
        decideTokenRefresh(
          input({
            providerId: 'google-drive',
            refreshTokenExpiresAt: new Date(NOW.getTime() + DAY_MS),
          })
        )
      ).toMatchObject({ shouldRefresh: false, reason: 'valid' })
    })
  })

  describe('Instagram long-lived aging', () => {
    const instagram = (overrides: Partial<RefreshDecisionInput>) =>
      decideTokenRefresh(input({ providerId: 'instagram', ...overrides }))

    it('proactively refreshes inside the 14-day window', () => {
      expect(
        instagram({
          accessTokenExpiresAt: new Date(NOW.getTime() + 10 * DAY_MS),
          updatedAt: new Date(NOW.getTime() - 30 * DAY_MS),
        })
      ).toEqual({
        shouldRefresh: true,
        accessTokenRequired: false,
        reason: 'instagram-long-lived-aging',
      })
    })

    /** Meta rejects refresh until the token is 24h old. */
    it('holds off on a token younger than 24 hours', () => {
      expect(
        instagram({
          accessTokenExpiresAt: new Date(NOW.getTime() + 10 * DAY_MS),
          updatedAt: new Date(NOW.getTime() - 60 * 60 * 1000),
        })
      ).toMatchObject({ shouldRefresh: false, reason: 'valid' })
    })

    it('leaves a token outside the window alone', () => {
      expect(
        instagram({ accessTokenExpiresAt: new Date(NOW.getTime() + 30 * DAY_MS) })
      ).toMatchObject({ shouldRefresh: false, reason: 'valid' })
    })

    /**
     * An already-expired Instagram token is unrecoverable, so it falls through to the
     * ordinary expired-access-token arm rather than the proactive one.
     */
    it('reports an already-expired token as expired, not aging', () => {
      expect(instagram({ accessTokenExpiresAt: new Date(NOW.getTime() - DAY_MS) })).toMatchObject({
        shouldRefresh: true,
        reason: 'access-token-expired',
      })
    })
  })

  /**
   * `accessTokenRequired` is what lets a caller reuse its stored token when a refresh
   * fails. Getting it wrong turns a recoverable proactive refresh failure into a hard
   * credential error.
   */
  describe('accessTokenRequired', () => {
    it.each([
      ['access token missing', input({ hasAccessToken: false }), true],
      ['access token expired', input({ accessTokenExpiresAt: new Date(NOW.getTime() - 1) }), true],
      [
        'Microsoft proactive',
        input({ providerId: 'outlook', refreshTokenExpiresAt: new Date(NOW.getTime() + DAY_MS) }),
        false,
      ],
      [
        'Instagram proactive',
        input({
          providerId: 'instagram',
          accessTokenExpiresAt: new Date(NOW.getTime() + 10 * DAY_MS),
        }),
        false,
      ],
    ])('is %s => %s', (_label, decision, expected) => {
      expect(decideTokenRefresh(decision).accessTokenRequired).toBe(expected)
    })
  })
})
