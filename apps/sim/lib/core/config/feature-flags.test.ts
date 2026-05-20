/**
 * @vitest-environment node
 */
import { createEnvMock } from '@sim/testing'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/config/env', () => createEnvMock())

import { env } from '@/lib/core/config/env'
import {
  __resetAllowedPrivateHostsCacheForTest,
  getAllowedPrivateHostsFromEnv,
  isAllowlistedPrivateHost,
} from '@/lib/core/config/feature-flags'

function withAllowedPrivateHosts(value: string | undefined) {
  ;(env as { ALLOWED_PRIVATE_HOSTS?: string }).ALLOWED_PRIVATE_HOSTS = value
  __resetAllowedPrivateHostsCacheForTest()
}

describe('getAllowedPrivateHostsFromEnv', () => {
  afterEach(() => {
    withAllowedPrivateHosts(undefined)
  })

  it('returns null when env var is unset', () => {
    expect(getAllowedPrivateHostsFromEnv()).toBeNull()
  })

  it('returns null when env var is empty after trimming', () => {
    withAllowedPrivateHosts('  ,  , ')
    expect(getAllowedPrivateHostsFromEnv()).toBeNull()
  })

  it('parses bare hostnames into the hostname set (lowercased)', () => {
    withAllowedPrivateHosts('Gitlab.Allot.Internal,siem.allot.internal')
    const result = getAllowedPrivateHostsFromEnv()
    expect(result?.hostnames).toEqual(new Set(['gitlab.allot.internal', 'siem.allot.internal']))
    expect(result?.cidrs).toEqual([])
  })

  it('parses literal IPs as exact /32 or /128 CIDRs', () => {
    withAllowedPrivateHosts('10.112.12.56,fd00::1')
    const result = getAllowedPrivateHostsFromEnv()
    expect(result?.cidrs).toHaveLength(2)
    expect(result?.cidrs[0][1]).toBe(32)
    expect(result?.cidrs[1][1]).toBe(128)
  })

  it('parses CIDR ranges', () => {
    withAllowedPrivateHosts('10.0.0.0/8,fd00::/8')
    const result = getAllowedPrivateHostsFromEnv()
    expect(result?.cidrs).toHaveLength(2)
    expect(result?.cidrs[0][1]).toBe(8)
    expect(result?.cidrs[1][1]).toBe(8)
  })

  it('mixes hostnames, IPs, and CIDRs in one list', () => {
    withAllowedPrivateHosts('gitlab.internal, 10.0.0.0/8 ,10.112.12.56 ')
    const result = getAllowedPrivateHostsFromEnv()
    expect(result?.hostnames.has('gitlab.internal')).toBe(true)
    expect(result?.cidrs).toHaveLength(2)
  })

  it('falls back to hostname when CIDR parse fails', () => {
    withAllowedPrivateHosts('not-a-cidr/bogus')
    const result = getAllowedPrivateHostsFromEnv()
    expect(result?.hostnames.has('not-a-cidr/bogus')).toBe(true)
  })

  it('caches the parse result across calls', () => {
    withAllowedPrivateHosts('gitlab.internal')
    const first = getAllowedPrivateHostsFromEnv()
    ;(env as { ALLOWED_PRIVATE_HOSTS?: string }).ALLOWED_PRIVATE_HOSTS = 'changed.internal'
    expect(getAllowedPrivateHostsFromEnv()).toBe(first)
  })
})

describe('isAllowlistedPrivateHost', () => {
  afterEach(() => {
    withAllowedPrivateHosts(undefined)
  })

  it('returns false when env var is unset', () => {
    expect(isAllowlistedPrivateHost({ ip: '10.0.0.1' })).toBe(false)
    expect(isAllowlistedPrivateHost({ hostname: 'gitlab.internal' })).toBe(false)
  })

  it('matches hostnames case-insensitively', () => {
    withAllowedPrivateHosts('gitlab.allot.internal')
    expect(isAllowlistedPrivateHost({ hostname: 'GITLAB.ALLOT.INTERNAL' })).toBe(true)
    expect(isAllowlistedPrivateHost({ hostname: 'other.internal' })).toBe(false)
  })

  it('matches literal IPv4 entries', () => {
    withAllowedPrivateHosts('10.112.12.56')
    expect(isAllowlistedPrivateHost({ ip: '10.112.12.56' })).toBe(true)
    expect(isAllowlistedPrivateHost({ ip: '10.112.12.57' })).toBe(false)
  })

  it('matches IPv4 CIDR ranges', () => {
    withAllowedPrivateHosts('10.0.0.0/8')
    expect(isAllowlistedPrivateHost({ ip: '10.0.0.1' })).toBe(true)
    expect(isAllowlistedPrivateHost({ ip: '10.255.255.255' })).toBe(true)
    expect(isAllowlistedPrivateHost({ ip: '11.0.0.1' })).toBe(false)
    expect(isAllowlistedPrivateHost({ ip: '192.168.1.1' })).toBe(false)
  })

  it('matches IPv6 CIDR ranges', () => {
    withAllowedPrivateHosts('fc00::/7')
    expect(isAllowlistedPrivateHost({ ip: 'fd00::1' })).toBe(true)
    expect(isAllowlistedPrivateHost({ ip: 'fd12:3456::1' })).toBe(true)
    expect(isAllowlistedPrivateHost({ ip: 'fc00::1' })).toBe(true)
    expect(isAllowlistedPrivateHost({ ip: '2001:db8::1' })).toBe(false)
  })

  it('does not cross-match IPv4 and IPv6 ranges', () => {
    withAllowedPrivateHosts('10.0.0.0/8')
    expect(isAllowlistedPrivateHost({ ip: 'fd00::1' })).toBe(false)
  })

  it('returns true if either hostname or IP matches', () => {
    withAllowedPrivateHosts('gitlab.allot.internal,10.0.0.0/8')
    expect(isAllowlistedPrivateHost({ hostname: 'gitlab.allot.internal', ip: '8.8.8.8' })).toBe(
      true
    )
    expect(isAllowlistedPrivateHost({ hostname: 'other.internal', ip: '10.5.5.5' })).toBe(true)
  })

  it('returns false for unparseable IPs', () => {
    withAllowedPrivateHosts('10.0.0.0/8')
    expect(isAllowlistedPrivateHost({ ip: 'not-an-ip' })).toBe(false)
  })
})
