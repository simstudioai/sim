import { describe, expect, it } from 'vitest'
import { isLoopbackHostname, unwrapIpv6Brackets } from './hostnames'

describe('isLoopbackHostname', () => {
  it('matches localhost and the loopback literals, brackets optional', () => {
    expect(isLoopbackHostname('localhost')).toBe(true)
    expect(isLoopbackHostname('127.0.0.1')).toBe(true)
    expect(isLoopbackHostname('::1')).toBe(true)
    expect(isLoopbackHostname('[::1]')).toBe(true)
  })

  it('does not match other loopback-range IPs or public hosts (exact-set only)', () => {
    expect(isLoopbackHostname('127.0.0.5')).toBe(false)
    expect(isLoopbackHostname('example.com')).toBe(false)
    expect(isLoopbackHostname('10.0.0.1')).toBe(false)
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
