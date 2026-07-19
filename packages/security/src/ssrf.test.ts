import { describe, expect, it } from 'vitest'
import { isPrivateIp, isPrivateIpHost, unwrapIpv6Brackets } from './ssrf'

describe('isPrivateIp', () => {
  describe('IPv4 private/reserved ranges', () => {
    it.each([
      ['192.168.1.1'],
      ['192.168.0.0'],
      ['10.0.0.1'],
      ['10.255.255.255'],
      ['172.16.0.1'],
      ['172.31.255.255'],
      ['127.0.0.1'],
      ['127.255.255.255'],
      ['169.254.169.254'],
      ['0.0.0.0'],
      ['224.0.0.1'],
    ])('blocks IPv4 %s', (ip) => {
      expect(isPrivateIp(ip)).toBe(true)
    })
  })

  describe('IPv6 reserved ranges', () => {
    it.each([['::1'], ['::'], ['fe80::1'], ['fc00::1'], ['fd00::1'], ['ff02::1'], ['2001:db8::1']])(
      'blocks IPv6 %s',
      (ip) => {
        expect(isPrivateIp(ip)).toBe(true)
      }
    )
  })

  describe('IPv4-mapped IPv6 (::ffff:0:0/96)', () => {
    it.each([
      ['::ffff:192.168.1.1'],
      ['::ffff:127.0.0.1'],
      ['::ffff:169.254.169.254'],
      ['::ffff:c0a8:101'],
      ['::ffff:0:0'],
    ])('blocks mapped private/reserved %s', (ip) => {
      expect(isPrivateIp(ip)).toBe(true)
    })

    it('allows mapped public IPv4 ::ffff:8.8.8.8', () => {
      expect(isPrivateIp('::ffff:8.8.8.8')).toBe(false)
    })
  })

  describe('NAT64 (RFC 6052, 64:ff9b::/96)', () => {
    it('blocks NAT64-encoded private IPv4', () => {
      expect(isPrivateIp('64:ff9b::192.168.1.1')).toBe(true)
    })
  })

  describe('IPv4-compatible IPv6 (::a.b.c.d, RFC 4291 §2.5.5.1, deprecated)', () => {
    it.each([
      ['::c0a8:101', '192.168.1.1 (URL-normalized hex form)'],
      ['::c0a8:0101', '192.168.1.1 (zero-padded hex form)'],
      ['::a9fe:a9fe', '169.254.169.254 (cloud metadata)'],
      ['::7f00:1', '127.0.0.1 (loopback)'],
      ['::7f00:0001', '127.0.0.1 (zero-padded)'],
      ['::a00:1', '10.0.0.1 (RFC1918)'],
      ['::ac10:1', '172.16.0.1 (RFC1918)'],
      ['::e000:1', '224.0.0.1 (multicast)'],
      ['::192.168.1.1', 'dotted form ::192.168.1.1'],
      ['::169.254.169.254', 'dotted form ::169.254.169.254'],
      ['::127.0.0.1', 'dotted form ::127.0.0.1'],
      ['::10.0.0.1', 'dotted form ::10.0.0.1'],
    ])('blocks %s — %s', (ip) => {
      expect(isPrivateIp(ip)).toBe(true)
    })

    it.each([
      ['::8.8.8.8', 'dotted form embedding public IPv4'],
      ['::808:808', 'hex form embedding 8.8.8.8'],
      ['::0808:0808', 'zero-padded hex form embedding 8.8.8.8'],
    ])('allows IPv4-compatible IPv6 with embedded public IPv4 %s — %s', (ip) => {
      expect(isPrivateIp(ip)).toBe(false)
    })

    it.each([
      ['::ffff:1', 'embedded 255.255.0.1 (Class E reserved) via parts[6]=0xffff'],
      ['::ffff:0', 'embedded 255.255.0.0 (Class E reserved)'],
      ['::ffff:abcd', 'embedded 255.255.171.205 (Class E reserved)'],
      ['::f000:1', 'embedded 240.0.0.1 (Class E reserved)'],
    ])('blocks IPv4-compatible IPv6 with Class E embedded IPv4 %s — %s', (ip) => {
      expect(isPrivateIp(ip)).toBe(true)
    })
  })

  describe('non-IPv4-compat unicast IPv6 (must not over-block)', () => {
    it.each([
      ['2606:4700:4700::1111'],
      ['2001:4860:4860::8888'],
      ['::1:c0a8:101'],
      ['1::c0a8:101'],
      ['1:2:3:4:5:6:c0a8:101'],
    ])('allows %s', (ip) => {
      expect(isPrivateIp(ip)).toBe(false)
    })
  })

  describe('IPv4 public addresses', () => {
    it.each([['8.8.8.8'], ['1.1.1.1'], ['1.0.0.1']])('allows %s', (ip) => {
      expect(isPrivateIp(ip)).toBe(false)
    })
  })

  describe('IPv4 alternate notations', () => {
    it.each([['0177.0.0.1'], ['0x7f000001'], ['2130706433']])(
      'blocks loopback notation %s',
      (ip) => {
        expect(isPrivateIp(ip)).toBe(true)
      }
    )
  })

  describe('invalid input fails closed', () => {
    it.each([['not-an-ip'], [''], ['256.256.256.256'], ['::g'], ['example.com']])(
      'rejects %s',
      (ip) => {
        expect(isPrivateIp(ip)).toBe(true)
      }
    )
  })

  describe('URL-parser normalized IPv6 forms', () => {
    it('blocks Node-normalized [::192.168.1.1] → ::c0a8:101', () => {
      const hostname = new URL('http://[::192.168.1.1]/').hostname
      expect(unwrapIpv6Brackets(hostname)).toBe('::c0a8:101')
      expect(isPrivateIp(unwrapIpv6Brackets(hostname))).toBe(true)
    })

    it('blocks Node-normalized [::169.254.169.254] → ::a9fe:a9fe', () => {
      const hostname = new URL('http://[::169.254.169.254]/').hostname
      expect(unwrapIpv6Brackets(hostname)).toBe('::a9fe:a9fe')
      expect(isPrivateIp(unwrapIpv6Brackets(hostname))).toBe(true)
    })
  })
})

describe('isPrivateIpHost', () => {
  it('blocks private/reserved IP literals (IPv4 and IPv6, bracketed or bare)', () => {
    expect(isPrivateIpHost('10.0.0.1')).toBe(true)
    expect(isPrivateIpHost('169.254.169.254')).toBe(true)
    expect(isPrivateIpHost('127.0.0.1')).toBe(true)
    expect(isPrivateIpHost('[::1]')).toBe(true)
    expect(isPrivateIpHost('[fd00:ec2::254]')).toBe(true)
    expect(isPrivateIpHost('[::ffff:127.0.0.1]')).toBe(true)
  })

  it('allows public IP literals', () => {
    expect(isPrivateIpHost('8.8.8.8')).toBe(false)
    expect(isPrivateIpHost('[2606:4700:4700::1111]')).toBe(false)
  })

  it('fails open on DNS names (resolution handled separately)', () => {
    expect(isPrivateIpHost('example.com')).toBe(false)
    expect(isPrivateIpHost('api.zoominfo.com')).toBe(false)
    expect(isPrivateIpHost('localhost')).toBe(false)
  })
})

describe('unwrapIpv6Brackets', () => {
  it('strips brackets from IPv6 authorities', () => {
    expect(unwrapIpv6Brackets('[::1]')).toBe('::1')
    expect(unwrapIpv6Brackets('[2606:4700::1111]')).toBe('2606:4700::1111')
  })

  it('leaves bare hostnames untouched', () => {
    expect(unwrapIpv6Brackets('example.com')).toBe('example.com')
    expect(unwrapIpv6Brackets('127.0.0.1')).toBe('127.0.0.1')
  })
})
