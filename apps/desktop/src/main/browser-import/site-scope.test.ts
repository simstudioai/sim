import { describe, expect, it } from 'vitest'
import { isCookieHostInScope, siteScopeFor } from '@/main/browser-import/site-scope'

/**
 * A per-site import must bring back the sign-in it was asked for and nothing
 * else. Each case is a way the scope could leak another site's cookies into
 * the built-in browser, or drop the ones the user just signed in for.
 */
describe('siteScopeFor', () => {
  it.each([
    [
      'a sign-in host widens to its registrable domain',
      'signin.aws.amazon.com',
      'amazon.com',
      false,
    ],
    ['a private suffix tenant stays itself', 'alice.github.io', 'alice.github.io', false],
    [
      'an AWS access portal stays itself',
      'd-1234567890.awsapps.com',
      'd-1234567890.awsapps.com',
      false,
    ],
    ['case and a root dot normalize', 'WWW.Example.COM.', 'example.com', false],
    ['an IPv4 host is exact', '127.0.0.1', '127.0.0.1', true],
    ['an IPv6 host is exact', '[::1]', '[::1]', true],
    ['a single-label host is exact', 'localhost', 'localhost', true],
  ])('%s', (_label, host, domain, exact) => {
    expect(siteScopeFor(host)).toEqual({ domain, exact })
  })

  it.each(['', '.'])('refuses the empty host %j', (host) => {
    expect(siteScopeFor(host)).toBeNull()
  })
})

describe('isCookieHostInScope', () => {
  function inScope(pageHost: string, hostKey: string): boolean {
    const scope = siteScopeFor(pageHost)
    if (!scope) throw new Error(`No scope for ${pageHost}`)
    return isCookieHostInScope(hostKey, scope)
  }

  it.each([
    ['www.example.com', 'example.com'],
    ['www.example.com', 'sub.example.com'],
    ['www.example.com', '.example.com'],
    ['www.example.com', '.deep.sub.example.com'],
    ['example.com', 'Sub.EXAMPLE.com'],
    ['signin.aws.amazon.com', 'console.aws.amazon.com'],
    ['alice.github.io', '.alice.github.io'],
    ['127.0.0.1', '127.0.0.1'],
    ['localhost', 'localhost'],
  ])('a page on %s brings back %s', (pageHost, hostKey) => {
    expect(inScope(pageHost, hostKey)).toBe(true)
  })

  it.each([
    ['example.com', 'example.com.evil.com'],
    ['example.com', '.example.com.evil.com'],
    ['example.com', 'notexample.com'],
    ['example.com', '.notexample.com'],
    ['example.com', 'evil.com'],
    ['example.com', '.com'],
    ['example.com', ''],
    ['example.com', '.'],
    ['signin.aws.amazon.com', 'amazon.co.uk'],
    ['alice.github.io', 'bob.github.io'],
    ['alice.github.io', '.github.io'],
    ['127.0.0.1', '127.0.0.10'],
    ['127.0.0.1', '10.127.0.0.1'],
    ['localhost', 'evil.localhost'],
  ])('a page on %s never brings back %s', (pageHost, hostKey) => {
    expect(inScope(pageHost, hostKey)).toBe(false)
  })
})
