/**
 * @vitest-environment node
 */
import type { OnHeadersReceivedListenerDetails, Session } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import {
  keepSessionCookiesAcrossRestarts,
  SESSION_COOKIE_LIFETIME_SECONDS,
  withSessionCookieLifetime,
  withSessionCookieMaxAge,
} from '@/main/browser-agent/session-cookies'

vi.mock('electron', () => import('@/test/electron-mock'))

const NOW = 1_800_000_000
const MAX_AGE = `Max-Age=${SESSION_COOKIE_LIFETIME_SECONDS}`

describe('withSessionCookieLifetime', () => {
  it('gives an expiry-less cookie the bounded lifetime', () => {
    expect(withSessionCookieLifetime({ url: 'https://example.com/', name: 'a' }, NOW)).toEqual({
      url: 'https://example.com/',
      name: 'a',
      expirationDate: NOW + SESSION_COOKIE_LIFETIME_SECONDS,
    })
  })

  it('leaves a cookie that already expires untouched', () => {
    const cookie = { url: 'https://example.com/', name: 'a', expirationDate: NOW + 60 }
    expect(withSessionCookieLifetime(cookie, NOW)).toBe(cookie)
  })
})

describe('withSessionCookieMaxAge', () => {
  it('adds Max-Age to a session cookie', () => {
    expect(withSessionCookieMaxAge('sid=abc; Path=/; Secure; HttpOnly')).toBe(
      `sid=abc; Path=/; Secure; HttpOnly; ${MAX_AGE}`
    )
    expect(withSessionCookieMaxAge('sid=abc')).toBe(`sid=abc; ${MAX_AGE}`)
  })

  it('leaves cookies with an expiry or a deletion untouched', () => {
    for (const value of [
      'sid=abc; Expires=Wed, 21 Oct 2030 07:28:00 GMT',
      'sid=abc; max-age=60',
      'sid=; Path=/; Max-Age=0',
      'sid=abc;EXPIRES=Thu, 01 Jan 1970 00:00:00 GMT',
    ]) {
      expect(withSessionCookieMaxAge(value)).toBe(value)
    }
  })

  it('reads attributes only, never the cookie value', () => {
    expect(withSessionCookieMaxAge('max-age=1')).toBe(`max-age=1; ${MAX_AGE}`)
  })
})

describe('keepSessionCookiesAcrossRestarts', () => {
  type Listener = (
    details: Pick<OnHeadersReceivedListenerDetails, 'responseHeaders'>,
    callback: (response: { responseHeaders?: Record<string, string[]> }) => void
  ) => void

  function install(): Listener {
    let listener: Listener | undefined
    const ses = {
      webRequest: {
        onHeadersReceived: vi.fn((handler: Listener) => {
          listener = handler
        }),
      },
    }
    keepSessionCookiesAcrossRestarts(ses as unknown as Session)
    if (!listener) throw new Error('listener not installed')
    return listener
  }

  it('rewrites every Set-Cookie value and keeps the other headers', () => {
    const callback = vi.fn()
    install()(
      {
        responseHeaders: {
          'content-type': ['text/html'],
          'Set-Cookie': ['sid=abc; HttpOnly', 'keep=1; Max-Age=60'],
        },
      },
      callback
    )

    expect(callback).toHaveBeenCalledWith({
      responseHeaders: {
        'content-type': ['text/html'],
        'Set-Cookie': [`sid=abc; HttpOnly; ${MAX_AGE}`, 'keep=1; Max-Age=60'],
      },
    })
  })

  it('leaves responses without cookies untouched', () => {
    const callback = vi.fn()
    install()({ responseHeaders: { 'content-type': ['text/html'] } }, callback)
    install()({}, callback)

    expect(callback).toHaveBeenNthCalledWith(1, {})
    expect(callback).toHaveBeenNthCalledWith(2, {})
  })
})
