import { createClientIpResolver, normalizeIpAddress } from '@sim/security/ip'
import { describe, expect, it } from 'vitest'

function headers(values: Record<string, string>): Headers {
  return new Headers(values)
}

describe('createClientIpResolver', () => {
  it('returns null when x-forwarded-for is absent', () => {
    const resolver = createClientIpResolver()

    expect(resolver.resolve(headers({ 'x-real-ip': '192.0.2.10' }))).toBeNull()
  })

  it('uses a single forwarded address', () => {
    const resolver = createClientIpResolver()

    expect(resolver.resolve(headers({ 'x-forwarded-for': '192.0.2.10' }))).toBe('192.0.2.10')
  })

  it('ignores attacker-controlled values to the left of an appended peer', () => {
    const resolver = createClientIpResolver()

    expect(resolver.resolve(headers({ 'x-forwarded-for': '198.51.100.20, 203.0.113.30' }))).toBe(
      '203.0.113.30'
    )
  })

  it('walks past configured trusted proxy hops', () => {
    const resolver = createClientIpResolver('10.0.0.0/8, 2001:db8:abcd::/48')

    expect(
      resolver.resolve(headers({ 'x-forwarded-for': '192.0.2.10, 10.0.0.12, 10.0.0.15' }))
    ).toBe('192.0.2.10')
    expect(resolver.trustedProxies).toEqual(['10.0.0.0/8', '2001:db8:abcd::/48'])
  })

  it('normalizes forwarded addresses with proxy-added ports', () => {
    const resolver = createClientIpResolver()

    expect(resolver.resolve(headers({ 'x-forwarded-for': '192.0.2.10:4312' }))).toBe('192.0.2.10')
    expect(resolver.resolve(headers({ 'x-forwarded-for': '[2001:db8::1]:4312' }))).toBe(
      '2001:db8::1'
    )
  })

  it('returns null when a required hop is malformed', () => {
    const resolver = createClientIpResolver('10.0.0.0/8')

    expect(resolver.resolve(headers({ 'x-forwarded-for': 'spoofed, 10.0.0.12' }))).toBeNull()
  })

  it('returns null when every forwarded hop is trusted', () => {
    const resolver = createClientIpResolver('10.0.0.0/8')

    expect(resolver.resolve(headers({ 'x-forwarded-for': '10.0.0.12, 10.0.0.15' }))).toBeNull()
  })

  it('fails fast for invalid or catch-all trusted proxy configuration', () => {
    expect(() => createClientIpResolver('not-an-ip')).toThrow(
      'Invalid AUTH_TRUSTED_PROXIES entry "not-an-ip"'
    )
    expect(() => createClientIpResolver('0.0.0.0/0')).toThrow('catch-all networks')
    expect(() => createClientIpResolver('10.0.0.0/8,')).toThrow('cannot contain empty entries')
  })
})

describe('normalizeIpAddress', () => {
  it('canonicalizes equivalent IPv6 and IPv4-mapped addresses', () => {
    expect(normalizeIpAddress('2001:0db8:0000:0000:0000:0000:0000:0001')).toBe('2001:db8::1')
    expect(normalizeIpAddress('::ffff:192.0.2.10')).toBe('192.0.2.10')
  })

  it('rejects invalid addresses', () => {
    expect(normalizeIpAddress('not-an-ip')).toBeNull()
  })
})
