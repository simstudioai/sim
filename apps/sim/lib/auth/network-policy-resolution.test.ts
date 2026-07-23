/**
 * @vitest-environment node
 *
 * Integration test for the client-IP RESOLUTION layer that the matcher's own
 * unit tests bypass: Better Auth's `getIp` (which masks IPv6 to `ipv6Subnet`)
 * composed with `buildIpResolutionOptions` and the allowlist matcher. Guards
 * against IPv6 addresses being silently collapsed to /64 before matching,
 * which would make exact-host (/128) entries impossible in production.
 */
import { getIp } from '@better-auth/core/utils/ip'
import {
  buildIpResolutionOptions,
  compileAllowlist,
  isAddressAllowed,
  parseTrustedProxies,
} from '@sim/platform-authz/network'
import { describe, expect, it } from 'vitest'

const OPTIONS = buildIpResolutionOptions(parseTrustedProxies(undefined))

function resolve(forwardedFor: string): string | null {
  const headers = new Headers({ 'x-forwarded-for': forwardedFor })
  return getIp(new Request('http://localhost/', { headers }), OPTIONS)
}

describe('network-policy IP resolution', () => {
  it('resolves IPv6 at full /128 precision (not masked to /64)', () => {
    // If ipv6Subnet defaulted to 64, this would return 2001:db8:1234:5678::.
    const resolved = resolve('2001:db8:1234:5678::1')
    expect(resolved).not.toBeNull()
    expect(isAddressAllowed(resolved as string, compileAllowlist(['2001:db8:1234:5678::1']))).toBe(
      true
    )
  })

  it('does not let a different host in the same /64 match an exact /128 entry', () => {
    const resolved = resolve('2001:db8:1234:5678::99')
    expect(isAddressAllowed(resolved as string, compileAllowlist(['2001:db8:1234:5678::1']))).toBe(
      false
    )
    // …but a /64 entry covers the whole subnet.
    expect(
      isAddressAllowed(resolved as string, compileAllowlist(['2001:db8:1234:5678::/64']))
    ).toBe(true)
  })

  it('resolves IPv4 unchanged', () => {
    const resolved = resolve('203.0.113.7')
    expect(resolved).toBe('203.0.113.7')
    expect(isAddressAllowed(resolved as string, compileAllowlist(['203.0.113.0/24']))).toBe(true)
  })
})
