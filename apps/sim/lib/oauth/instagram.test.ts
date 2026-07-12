import { describe, expect, it } from 'vitest'
import {
  INSTAGRAM_MIN_TOKEN_AGE_MS,
  INSTAGRAM_PROACTIVE_REFRESH_THRESHOLD_DAYS,
  isInstagramProvider,
  shouldProactivelyRefreshInstagramToken,
} from '@/lib/oauth/instagram'

describe('instagram oauth helpers', () => {
  it('identifies the instagram provider', () => {
    expect(isInstagramProvider('instagram')).toBe(true)
    expect(isInstagramProvider('facebook')).toBe(false)
  })

  it('does not refresh when the token is already expired', () => {
    const now = new Date('2026-07-11T12:00:00.000Z')
    expect(
      shouldProactivelyRefreshInstagramToken({
        accessTokenExpiresAt: new Date(now.getTime() - 60_000),
        updatedAt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
        now,
      })
    ).toBe(false)
  })

  it('does not refresh tokens younger than 24 hours', () => {
    const now = new Date('2026-07-11T12:00:00.000Z')
    expect(
      shouldProactivelyRefreshInstagramToken({
        accessTokenExpiresAt: new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000),
        updatedAt: new Date(now.getTime() - INSTAGRAM_MIN_TOKEN_AGE_MS + 60_000),
        now,
      })
    ).toBe(false)
  })

  it('refreshes when expiry is within the proactive window and the token is old enough', () => {
    const now = new Date('2026-07-11T12:00:00.000Z')
    expect(
      shouldProactivelyRefreshInstagramToken({
        accessTokenExpiresAt: new Date(
          now.getTime() + (INSTAGRAM_PROACTIVE_REFRESH_THRESHOLD_DAYS - 1) * 24 * 60 * 60 * 1000
        ),
        updatedAt: new Date(now.getTime() - INSTAGRAM_MIN_TOKEN_AGE_MS - 60_000),
        now,
      })
    ).toBe(true)
  })

  it('does not refresh when plenty of lifetime remains', () => {
    const now = new Date('2026-07-11T12:00:00.000Z')
    expect(
      shouldProactivelyRefreshInstagramToken({
        accessTokenExpiresAt: new Date(
          now.getTime() + (INSTAGRAM_PROACTIVE_REFRESH_THRESHOLD_DAYS + 5) * 24 * 60 * 60 * 1000
        ),
        updatedAt: new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000),
        now,
      })
    ).toBe(false)
  })
})
