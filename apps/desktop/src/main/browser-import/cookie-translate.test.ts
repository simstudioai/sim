import { describe, expect, it } from 'vitest'
import { chromeTimeToUnixSeconds, translateCookieRow } from '@/main/browser-import/cookie-translate'
import type { ChromiumCookieRow } from '@/main/browser-import/types'

const NOW_SECONDS = 1_800_000_000

/** Chrome's microsecond-since-1601 encoding of a Unix timestamp. */
function chromeTime(unixSeconds: number): number {
  return (unixSeconds + 11_644_473_600) * 1_000_000
}

function row(overrides: Partial<ChromiumCookieRow> = {}): ChromiumCookieRow {
  return {
    hostKey: 'www.example.com',
    name: 'session',
    path: '/',
    expiresUtc: chromeTime(NOW_SECONDS + 3600),
    isSecure: true,
    isHttpOnly: true,
    hasExpires: true,
    isPersistent: true,
    sameSite: 1,
    ...overrides,
  }
}

describe('chromeTimeToUnixSeconds', () => {
  it('converts from the 1601 epoch', () => {
    expect(chromeTimeToUnixSeconds(chromeTime(1_700_000_000))).toBe(1_700_000_000)
  })
})

describe('translateCookieRow', () => {
  it('preserves the security attributes of a host-only cookie', () => {
    const outcome = translateCookieRow(row(), 'abc', NOW_SECONDS)

    expect(outcome).toEqual({
      ok: true,
      cookie: {
        url: 'https://www.example.com/',
        name: 'session',
        value: 'abc',
        path: '/',
        secure: true,
        httpOnly: true,
        sameSite: 'lax',
        expirationDate: NOW_SECONDS + 3600,
      },
    })
  })

  it('omits domain for host-only cookies so they are not widened to subdomains', () => {
    const outcome = translateCookieRow(row({ hostKey: 'www.example.com' }), 'abc', NOW_SECONDS)
    expect(outcome.ok && 'domain' in outcome.cookie).toBe(false)
  })

  it('carries the leading dot through for domain cookies', () => {
    const outcome = translateCookieRow(row({ hostKey: '.example.com' }), 'abc', NOW_SECONDS)
    expect(outcome.ok && outcome.cookie.domain).toBe('.example.com')
    expect(outcome.ok && outcome.cookie.url).toBe('https://example.com/')
  })

  it('uses an http target for cookies that are not Secure', () => {
    const outcome = translateCookieRow(row({ isSecure: false }), 'abc', NOW_SECONDS)
    expect(outcome.ok && outcome.cookie.url).toBe('http://www.example.com/')
    expect(outcome.ok && outcome.cookie.secure).toBe(false)
  })

  it.each([
    [-1, 'unspecified'],
    [0, 'no_restriction'],
    [1, 'lax'],
    [2, 'strict'],
    [99, 'unspecified'],
  ])('maps Chrome samesite %i to %s', (sameSite, expected) => {
    const outcome = translateCookieRow(row({ sameSite }), 'abc', NOW_SECONDS)
    expect(outcome.ok && outcome.cookie.sameSite).toBe(expected)
  })

  it('drops expired cookies', () => {
    const outcome = translateCookieRow(
      row({ expiresUtc: chromeTime(NOW_SECONDS - 1) }),
      'abc',
      NOW_SECONDS
    )
    expect(outcome).toEqual({ ok: false, reason: 'expired' })
  })

  it('keeps session cookies without an expiry', () => {
    const outcome = translateCookieRow(
      row({ hasExpires: false, isPersistent: false }),
      'abc',
      NOW_SECONDS
    )
    expect(outcome.ok && 'expirationDate' in outcome.cookie).toBe(false)
  })

  it('normalizes a path that is missing its leading slash', () => {
    const outcome = translateCookieRow(row({ path: 'account' }), 'abc', NOW_SECONDS)
    expect(outcome.ok && outcome.cookie.path).toBe('/account')
    expect(outcome.ok && outcome.cookie.url).toBe('https://www.example.com/account')
  })

  it.each([
    ['evil.com/path@good.com'],
    ['good.com:8443'],
    ['user:pass@good.com'],
    [''],
    ['.'],
    ['has space.com'],
  ])('refuses a host_key that cannot be trusted to name one host: %s', (hostKey) => {
    expect(translateCookieRow(row({ hostKey }), 'abc', NOW_SECONDS)).toEqual({
      ok: false,
      reason: 'invalid-target',
    })
  })

  it('drops a row with neither a name nor a value', () => {
    expect(translateCookieRow(row({ name: '' }), '', NOW_SECONDS)).toEqual({
      ok: false,
      reason: 'empty',
    })
  })
})
