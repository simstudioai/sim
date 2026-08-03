import { describe, expect, it } from 'vitest'
import {
  canonicalizeIp,
  getAssertedOriginIp,
  parseTrustedProxies,
  parseTrustForwardedHeaders,
  resolveClientIp,
  UNKNOWN_CLIENT_IP,
} from './client-ip'

function req(headers: Record<string, string>) {
  return { headers: new Headers(headers) }
}

describe('resolveClientIp', () => {
  describe('spoofing resistance', () => {
    it('ignores a caller-supplied leftmost hop in favour of the proxy-appended one', () => {
      expect(resolveClientIp(req({ 'x-forwarded-for': '203.0.113.7, 198.51.100.4' }))).toBe(
        '198.51.100.4'
      )
    })

    it('returns the same address regardless of what the caller prepends', () => {
      const a = resolveClientIp(req({ 'x-forwarded-for': '10.0.0.1, 198.51.100.4' }))
      const b = resolveClientIp(req({ 'x-forwarded-for': '10.0.0.2, 198.51.100.4' }))
      const c = resolveClientIp(req({ 'x-forwarded-for': 'unknown, 198.51.100.4' }))
      expect(new Set([a, b, c])).toEqual(new Set(['198.51.100.4']))
    })

    it('strips IPv6 zone ids so they cannot mint unbounded distinct keys', () => {
      // `ipaddr.isValid` accepts an arbitrary-length zone and `process()` keeps
      // it verbatim, so an unstripped zone would be attacker-chosen text in the
      // key. The /64 mask happens to drop zones from v6 keys too — the
      // getAssertedOriginIp cases below pin the stripping on its own, since
      // that path is deliberately unmasked.
      const zoned = ['fe80::1%eth0', 'fe80::1%evil', `fe80::1%${'x'.repeat(200)}`].map((value) =>
        resolveClientIp(req({ 'x-forwarded-for': value }))
      )
      expect(new Set(zoned)).toEqual(new Set(['fe80::']))
      expect(resolveClientIp(req({ 'x-real-ip': 'fe80::1%evil' }))).toBe('fe80::')
      expect(canonicalizeIp('fe80::1%evil')).toBe('fe80::1')
    })

    it('masks IPv6 to its routed /64 so one subscriber is one bucket', () => {
      // A single IPv6 client is delegated a whole /64, so the proxy honestly
      // writes a different address per request. Keying on the full /128 would
      // leave per-IP throttles bypassable with no spoofing at all.
      const withinOnePrefix = [
        '2001:db8:1:2::1',
        '2001:db8:1:2::dead:beef',
        '2001:db8:1:2:ffff:ffff:ffff:ffff',
      ].map((value) => resolveClientIp(req({ 'x-forwarded-for': value })))
      expect(new Set(withinOnePrefix)).toEqual(new Set(['2001:db8:1:2::']))
    })

    it('keeps distinct IPv6 /64s in distinct buckets', () => {
      const a = resolveClientIp(req({ 'x-forwarded-for': '2001:db8:1:2::1' }))
      const b = resolveClientIp(req({ 'x-forwarded-for': '2001:db8:1:3::1' }))
      expect(a).not.toBe(b)
    })

    it('does not mask IPv4, which is already a single host', () => {
      expect(resolveClientIp(req({ 'x-forwarded-for': '198.51.100.4' }))).toBe('198.51.100.4')
    })

    it('masks the x-real-ip fallback too', () => {
      expect(resolveClientIp(req({ 'x-real-ip': '2001:db8:1:2::99' }))).toBe('2001:db8:1:2::')
    })

    it('matches a trusted range against the full address, not the masked key', () => {
      // Masking before the trust check would compare a different address.
      const trusted = parseTrustedProxies('2001:db8:1:2::abcd/128')
      expect(
        resolveClientIp(req({ 'x-forwarded-for': '203.0.113.7, 2001:db8:1:2::abcd' }), trusted)
      ).toBe('203.0.113.7')
    })

    it('collapses equivalent spellings of one address onto a single value', () => {
      const forms = ['198.51.100.4', '::ffff:198.51.100.4', '0xc6336404', '198.51.100.4:4444']
      const resolved = forms.map((form) => resolveClientIp(req({ 'x-forwarded-for': form })))
      expect(new Set(resolved)).toEqual(new Set(['198.51.100.4']))
    })
  })

  describe('trusted proxy chain', () => {
    it('skips trusted hops and returns the first untrusted address', () => {
      const trusted = parseTrustedProxies('198.51.100.0/24')
      expect(
        resolveClientIp(req({ 'x-forwarded-for': '203.0.113.7, 198.51.100.4' }), trusted)
      ).toBe('203.0.113.7')
    })

    it('accepts bare addresses as single-host trusted ranges', () => {
      const trusted = parseTrustedProxies('198.51.100.4, 192.0.2.10')
      expect(
        resolveClientIp(
          req({ 'x-forwarded-for': '203.0.113.7, 192.0.2.10, 198.51.100.4' }),
          trusted
        )
      ).toBe('203.0.113.7')
    })

    it('stops at the first untrusted hop rather than walking to the leftmost', () => {
      const trusted = parseTrustedProxies('198.51.100.4')
      expect(
        resolveClientIp(req({ 'x-forwarded-for': '10.0.0.1, 203.0.113.7, 198.51.100.4' }), trusted)
      ).toBe('203.0.113.7')
    })

    it('falls back to the rightmost hop when the whole chain is trusted', () => {
      const trusted = parseTrustedProxies('198.51.100.0/24')
      expect(
        resolveClientIp(req({ 'x-forwarded-for': '198.51.100.1, 198.51.100.4' }), trusted)
      ).toBe('198.51.100.4')
    })

    it('cannot be bypassed by forging a hop from inside a broad trusted range', () => {
      // The docs recommend ranges like 10.0.0.0/16. A caller who forges an
      // address from inside it makes every hop "trusted"; the resolver must
      // still land on the proxy-written hop, not the forged one.
      const trusted = parseTrustedProxies('10.0.0.0/16')
      const forged = ['10.0.99.99', '10.0.7.7', '10.0.1.2'].map((spoof) =>
        resolveClientIp(req({ 'x-forwarded-for': `${spoof}, 10.0.0.1` }), trusted)
      )
      expect(new Set(forged)).toEqual(new Set(['10.0.0.1']))
    })

    it('does not treat an IPv6 hop as matching an IPv4 trusted range', () => {
      // Two hops, so a wrongly-trusted rightmost entry would visibly shift the
      // answer left rather than merely avoiding a kind-mismatch throw.
      const trusted = parseTrustedProxies('0.0.0.0/0')
      expect(
        resolveClientIp(req({ 'x-forwarded-for': '2001:db8:1::1, 2001:db8:2::2' }), trusted)
      ).toBe('2001:db8:2::')
    })

    it('matches an IPv4-mapped IPv6 trusted range against the unwrapped hop', () => {
      const trusted = parseTrustedProxies('::ffff:10.0.0.0/104')
      expect(
        resolveClientIp(req({ 'x-forwarded-for': '203.0.113.5, ::ffff:10.0.0.1' }), trusted)
      ).toBe('203.0.113.5')
    })

    it('matches IPv6 trusted ranges', () => {
      const trusted = parseTrustedProxies('2001:db8::/32')
      expect(resolveClientIp(req({ 'x-forwarded-for': '203.0.113.7, 2001:db8::1' }), trusted)).toBe(
        '203.0.113.7'
      )
    })
  })

  describe('header parsing', () => {
    it('handles a single-hop chain', () => {
      expect(resolveClientIp(req({ 'x-forwarded-for': '198.51.100.4' }))).toBe('198.51.100.4')
    })

    it('strips brackets and ports from IPv6 hops', () => {
      // Masked to /64 like every IPv6 key; unmasked forms are covered by
      // getAssertedOriginIp below.
      expect(resolveClientIp(req({ 'x-forwarded-for': '[2001:db8::1]:8080' }))).toBe('2001:db8::')
    })

    it('accepts a bare IPv6 literal', () => {
      expect(resolveClientIp(req({ 'x-forwarded-for': '2001:db8::1' }))).toBe('2001:db8::')
    })

    it('skips unparseable hops while walking right to left', () => {
      expect(resolveClientIp(req({ 'x-forwarded-for': '198.51.100.4, _hidden' }))).toBe(
        '198.51.100.4'
      )
    })

    it('falls back to x-real-ip when x-forwarded-for holds no address', () => {
      expect(
        resolveClientIp(req({ 'x-forwarded-for': 'unknown', 'x-real-ip': '198.51.100.4' }))
      ).toBe('198.51.100.4')
    })

    it('prefers x-forwarded-for over x-real-ip when both parse', () => {
      expect(
        resolveClientIp(req({ 'x-forwarded-for': '198.51.100.4', 'x-real-ip': '10.0.0.1' }))
      ).toBe('198.51.100.4')
    })

    it('returns the unknown sentinel when no header yields an address', () => {
      expect(resolveClientIp(req({}))).toBe(UNKNOWN_CLIENT_IP)
      expect(resolveClientIp(req({ 'x-forwarded-for': 'unknown, garbage' }))).toBe(
        UNKNOWN_CLIENT_IP
      )
    })
  })
})

describe('getAssertedOriginIp', () => {
  it('returns the leftmost hop — the sender the delivery claims to be', () => {
    expect(getAssertedOriginIp(req({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }))).toBe(
      '203.0.113.7'
    )
  })

  it('is the opposite end of the chain from the throttling key', () => {
    const request = req({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' })
    expect(getAssertedOriginIp(request)).not.toBe(resolveClientIp(request))
  })

  it('canonicalizes so an allowlist entry matches any spelling of the address', () => {
    expect(getAssertedOriginIp(req({ 'x-forwarded-for': '::ffff:203.0.113.7' }))).toBe(
      canonicalizeIp('203.0.113.7')
    )
    expect(canonicalizeIp('01.02.03.04')).toBe('1.2.3.4')
    expect(canonicalizeIp('2001:0db8:0000:0000:0000:0000:0000:0001')).toBe('2001:db8::1')
  })

  it('skips unparseable leading hops', () => {
    expect(getAssertedOriginIp(req({ 'x-forwarded-for': 'unknown, 203.0.113.7' }))).toBe(
      '203.0.113.7'
    )
  })

  it('falls back to x-real-ip for proxies that set it instead of a chain', () => {
    expect(getAssertedOriginIp(req({ 'x-real-ip': '203.0.113.7' }))).toBe('203.0.113.7')
    expect(
      getAssertedOriginIp(req({ 'x-forwarded-for': 'unknown', 'x-real-ip': '203.0.113.7' }))
    ).toBe('203.0.113.7')
  })

  it('prefers the forwarded chain over x-real-ip when both parse', () => {
    expect(
      getAssertedOriginIp(req({ 'x-forwarded-for': '203.0.113.7', 'x-real-ip': '10.0.0.1' }))
    ).toBe('203.0.113.7')
  })

  it('does not mask IPv6 — an allowlist needs the exact address', () => {
    expect(getAssertedOriginIp(req({ 'x-forwarded-for': '2001:db8:1:2::99' }))).toBe(
      '2001:db8:1:2::99'
    )
  })

  it('strips brackets, ports, and zone ids like the resolver does', () => {
    expect(getAssertedOriginIp(req({ 'x-forwarded-for': '[2001:db8::1%eth0]:8080' }))).toBe(
      '2001:db8::1'
    )
    expect(getAssertedOriginIp(req({ 'x-forwarded-for': '203.0.113.7:4444' }))).toBe('203.0.113.7')
  })

  it('returns null when no header yields an address', () => {
    expect(getAssertedOriginIp(req({}))).toBeNull()
    expect(getAssertedOriginIp(req({ 'x-forwarded-for': 'unknown' }))).toBeNull()
    expect(canonicalizeIp('not-an-ip')).toBeNull()
  })
})

describe('parseTrustedProxies', () => {
  it('treats empty, null, and undefined input as trusting nothing', () => {
    expect(parseTrustedProxies('').cidrs).toHaveLength(0)
    expect(parseTrustedProxies(null).cidrs).toHaveLength(0)
    expect(parseTrustedProxies(undefined).cidrs).toHaveLength(0)
  })

  it('drops malformed entries instead of throwing, keeping the valid ones', () => {
    const trusted = parseTrustedProxies('not-an-ip, 10.0.0.0/99, , 198.51.100.4')
    expect(trusted.cidrs).toHaveLength(1)
    expect(resolveClientIp(req({ 'x-forwarded-for': '203.0.113.7, 198.51.100.4' }), trusted)).toBe(
      '203.0.113.7'
    )
  })

  it('ignores surrounding whitespace', () => {
    const trusted = parseTrustedProxies('  198.51.100.0/24 ,  192.0.2.10  ')
    expect(trusted.cidrs).toHaveLength(2)
  })
})

describe('parseTrustForwardedHeaders', () => {
  it('defaults to trusting the headers when unset', () => {
    // Unset must never silently disable IP resolution — that would turn every
    // per-IP limit into one global bucket on an ordinary proxied deployment.
    expect(parseTrustForwardedHeaders(undefined)).toBe(true)
    expect(parseTrustForwardedHeaders(null)).toBe(true)
    expect(parseTrustForwardedHeaders('')).toBe(true)
    expect(parseTrustForwardedHeaders('   ')).toBe(true)
  })

  it('accepts the usual falsey spellings, case- and space-insensitively', () => {
    for (const value of ['false', 'FALSE', ' False ', '0', 'no', 'off', 'OFF']) {
      expect(parseTrustForwardedHeaders(value)).toBe(false)
    }
  })

  it('accepts a real boolean, since one caller reads a parsed env', () => {
    expect(parseTrustForwardedHeaders(false)).toBe(false)
    expect(parseTrustForwardedHeaders(true)).toBe(true)
  })

  it('treats anything else as trusting', () => {
    for (const value of ['true', 'yes', 'on', '1', 'anything']) {
      expect(parseTrustForwardedHeaders(value)).toBe(true)
    }
  })
})
