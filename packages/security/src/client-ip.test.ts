import { describe, expect, it } from 'vitest'
import {
  canonicalizeIp,
  getAssertedOriginIp,
  parseTrustedProxies,
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
      const zoned = ['fe80::1%eth0', 'fe80::1%evil', `fe80::1%${'x'.repeat(200)}`].map((value) =>
        resolveClientIp(req({ 'x-forwarded-for': value }))
      )
      expect(new Set(zoned)).toEqual(new Set(['fe80::1']))
      expect(resolveClientIp(req({ 'x-real-ip': 'fe80::1%evil' }))).toBe('fe80::1')
      expect(resolveClientIp(req({ 'x-forwarded-for': '[fe80::1%eth0]:8080' }))).toBe('fe80::1')
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
      const trusted = parseTrustedProxies('0.0.0.0/0')
      expect(resolveClientIp(req({ 'x-forwarded-for': '2001:db8::1' }), trusted)).toBe(
        '2001:db8::1'
      )
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
      expect(resolveClientIp(req({ 'x-forwarded-for': '[2001:db8::1]:8080' }))).toBe('2001:db8::1')
    })

    it('preserves a bare IPv6 literal', () => {
      expect(resolveClientIp(req({ 'x-forwarded-for': '2001:db8::1' }))).toBe('2001:db8::1')
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

  it('returns null when there is no forwarded chain or no address in it', () => {
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
