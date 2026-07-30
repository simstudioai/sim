import { describe, expect, it } from 'vitest'
import {
  INSTAGRAM_MIN_TOKEN_AGE_MS,
  INSTAGRAM_PROACTIVE_REFRESH_THRESHOLD_DAYS,
  isInstagramProvider,
  parseInstagramLongLivedToken,
  parseInstagramProfile,
  parseInstagramShortLivedToken,
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

  it('parses direct and data-array short-lived token responses', () => {
    expect(
      parseInstagramShortLivedToken({
        access_token: 'short-token',
        user_id: 123,
        permissions: ['instagram_business_basic'],
      })
    ).toEqual({
      access_token: 'short-token',
      user_id: 123,
      permissions: ['instagram_business_basic'],
    })
    expect(
      parseInstagramShortLivedToken({ data: [{ access_token: 'wrapped-token', user_id: '456' }] })
    ).toEqual({ access_token: 'wrapped-token', user_id: '456' })
  })

  it('rejects malformed or oversized token responses', () => {
    expect(parseInstagramShortLivedToken({ access_token: 123 })).toBeNull()
    expect(
      parseInstagramLongLivedToken({ access_token: 'token', expires_in: '5184000' })
    ).toBeNull()
    expect(parseInstagramLongLivedToken({ access_token: 'token' })).toBeNull()
    expect(
      parseInstagramLongLivedToken({
        access_token: 'token',
        expires_in: 366 * 24 * 60 * 60,
      })
    ).toBeNull()
  })

  it('parses bounded long-lived token and profile responses', () => {
    expect(
      parseInstagramLongLivedToken({
        access_token: 'long-token',
        token_type: 'bearer',
        expires_in: 5_184_000,
      })
    ).toEqual({
      access_token: 'long-token',
      token_type: 'bearer',
      expires_in: 5_184_000,
    })
    expect(
      parseInstagramProfile({ user_id: 123, id: 'graph-id', username: 'sim', name: 'Sim' })
    ).toEqual({ user_id: 123, id: 'graph-id', username: 'sim', name: 'Sim' })
    expect(parseInstagramProfile({ user_id: { nested: true } })).toBeNull()
  })
})
