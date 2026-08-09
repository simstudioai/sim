import { describe, expect, it } from 'vitest'
import {
  findMalformedTrustedProxies,
  isAllTrustingProxyEntry,
  parseTrustedProxies,
  resolveClientIp,
} from './client-ip'

/** Builds a request stub carrying only the given headers. */
function requestWith(headers: Record<string, string>) {
  const normalized = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
  return { headers: { get: (name: string) => normalized.get(name.toLowerCase()) ?? null } }
}

/** A CIDR covering the load balancer subnet in the multi-hop cases below. */
const LB_SUBNET = ['10.0.0.0/8']

describe('resolveClientIp', () => {
  describe('without trusted proxies', () => {
    it('trusts a single-value forwarded header', () => {
      expect(resolveClientIp(requestWith({ 'x-forwarded-for': '203.0.113.7' }))).toBe('203.0.113.7')
    })

    it('refuses to resolve a multi-hop chain', () => {
      // The chain cannot be verified without knowing which hops are ours, and
      // the leftmost token is client-supplied. Returning either end would be a
      // guess; only `null` is honest.
      expect(
        resolveClientIp(requestWith({ 'x-forwarded-for': '203.0.113.7, 198.51.100.1' }))
      ).toBeNull()
    })

    it('returns null when no forwarded header is present', () => {
      expect(resolveClientIp(requestWith({}))).toBeNull()
    })

    it('never returns the literal "unknown"', () => {
      expect(resolveClientIp(requestWith({ 'x-forwarded-for': 'unknown' }))).toBeNull()
    })
  })

  describe('with trusted proxies', () => {
    it('returns the first untrusted hop, walking right to left', () => {
      expect(
        resolveClientIp(requestWith({ 'x-forwarded-for': '203.0.113.7, 10.0.0.5' }), {
          trustedProxies: LB_SUBNET,
        })
      ).toBe('203.0.113.7')
    })

    it('ignores a client-prepended address ahead of the real one', () => {
      // The spoof case: an attacker sends `X-Forwarded-For: 203.0.113.9`, the
      // load balancer appends the true peer, and the header arrives as the
      // chain below. The attacker's value must not win.
      const resolved = resolveClientIp(
        requestWith({ 'x-forwarded-for': '203.0.113.9, 198.51.100.1, 10.0.0.5' }),
        { trustedProxies: LB_SUBNET }
      )
      expect(resolved).toBe('198.51.100.1')
      expect(resolved).not.toBe('203.0.113.9')
    })

    it('fails closed on a malformed hop rather than skipping it', () => {
      expect(
        resolveClientIp(requestWith({ 'x-forwarded-for': '203.0.113.7, not-an-ip, 10.0.0.5' }), {
          trustedProxies: LB_SUBNET,
        })
      ).toBeNull()
    })

    it('returns null when every hop is trusted', () => {
      expect(
        resolveClientIp(requestWith({ 'x-forwarded-for': '10.0.0.4, 10.0.0.5' }), {
          trustedProxies: LB_SUBNET,
        })
      ).toBeNull()
    })

    it('resolves nothing when the trusted set covers every address', () => {
      // `0.0.0.0/0` is valid CIDR, so it survives parsing and then matches
      // every hop — the walk runs off the end and yields null rather than
      // falling back to the client-supplied leftmost token.
      expect(
        resolveClientIp(requestWith({ 'x-forwarded-for': '203.0.113.9, 10.0.0.5' }), {
          trustedProxies: ['0.0.0.0/0'],
        })
      ).toBeNull()
      expect(
        resolveClientIp(requestWith({ 'x-forwarded-for': '203.0.113.9' }), {
          trustedProxies: ['0.0.0.0/0'],
        })
      ).toBeNull()
    })

    it('ignores malformed trusted-proxy entries instead of trusting the chain', () => {
      // A typo must not silently disable the chain walk and hand back a real
      // proxy hop as though it were the client.
      expect(
        resolveClientIp(requestWith({ 'x-forwarded-for': '203.0.113.7, 10.0.0.5' }), {
          trustedProxies: ['not-a-cidr'],
        })
      ).toBeNull()
    })
  })

  describe('header precedence', () => {
    it('prefers x-forwarded-for over x-real-ip', () => {
      expect(
        resolveClientIp(
          requestWith({ 'x-forwarded-for': '203.0.113.7', 'x-real-ip': '198.51.100.1' })
        )
      ).toBe('203.0.113.7')
    })

    it('falls back to x-real-ip when x-forwarded-for yields nothing', () => {
      expect(
        resolveClientIp(requestWith({ 'x-forwarded-for': 'garbage', 'x-real-ip': '198.51.100.1' }))
      ).toBe('198.51.100.1')
    })

    it('honors an explicit header list', () => {
      expect(
        resolveClientIp(requestWith({ 'x-real-ip': '198.51.100.1' }), {
          headers: ['x-forwarded-for'],
        })
      ).toBeNull()
    })
  })

  describe('IPv6', () => {
    it('unwraps an IPv4-mapped address to its IPv4 form', () => {
      expect(resolveClientIp(requestWith({ 'x-forwarded-for': '::ffff:203.0.113.7' }))).toBe(
        '203.0.113.7'
      )
    })

    it('preserves the full address rather than masking it to a /64', () => {
      // Better Auth masks IPv6 to a /64 by default, which would collapse every
      // address in a subnet to one value. Identification needs the whole thing,
      // returned in the fully-expanded canonical form.
      expect(resolveClientIp(requestWith({ 'x-forwarded-for': '2001:db8::dead:beef' }))).toBe(
        '2001:0db8:0000:0000:0000:0000:dead:beef'
      )
    })

    it('canonicalizes two spellings of one address to the same value', () => {
      // The property downstream equality checks depend on: a caller must never
      // see the same client as two different addresses because the proxy
      // compressed the zero groups differently.
      const compressed = resolveClientIp(requestWith({ 'x-forwarded-for': '2001:db8::1' }))
      const expanded = resolveClientIp(
        requestWith({ 'x-forwarded-for': '2001:0db8:0000:0000:0000:0000:0000:0001' })
      )
      expect(compressed).toBe(expanded)
    })
  })
})

describe('parseTrustedProxies', () => {
  it('splits, trims, and drops empty entries', () => {
    expect(parseTrustedProxies(' 10.0.0.0/8 , ,192.168.0.0/16 ')).toEqual([
      '10.0.0.0/8',
      '192.168.0.0/16',
    ])
  })

  it('returns an empty list for an absent value', () => {
    expect(parseTrustedProxies(undefined)).toEqual([])
    expect(parseTrustedProxies('')).toEqual([])
  })
})

describe('findMalformedTrustedProxies', () => {
  it('reports only the entries that are not an IP or CIDR', () => {
    expect(
      findMalformedTrustedProxies(['10.0.0.0/8', 'nope', '203.0.113.7', '10.0.0.0/8x'])
    ).toEqual(['nope', '10.0.0.0/8x'])
  })
})

describe('isAllTrustingProxyEntry', () => {
  it('flags the ranges that trust every hop', () => {
    expect(isAllTrustingProxyEntry('0.0.0.0/0')).toBe(true)
    expect(isAllTrustingProxyEntry(' ::/0 ')).toBe(true)
  })

  it('leaves a bounded range alone', () => {
    expect(isAllTrustingProxyEntry('10.0.0.0/8')).toBe(false)
  })
})
