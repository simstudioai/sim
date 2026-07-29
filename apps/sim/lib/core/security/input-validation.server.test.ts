/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockResolve } = vi.hoisted(() => ({ mockResolve: vi.fn() }))

vi.mock('@sim/security/dns', () => ({
  resolveHostAddresses: mockResolve,
  // Mirrors the real rule so a pin taken over a narrowed set behaves as it does
  // in production; a stub returning addresses[0] would hide the divergence the
  // preference exists for.
  preferIpv4: (addresses: string[]) =>
    addresses.find((address) => address.includes('.')) ?? addresses[0],
}))

vi.mock('@/lib/core/config/env-flags', () => ({
  isHosted: false,
  isPrivateDatabaseHostsAllowed: false,
  getProxyUrl: () => undefined,
}))

import { validateUrlWithDNS } from '@/lib/core/security/input-validation.server'

/**
 * Shapes a resolver answer the way `resolveHostAddresses` does, including its
 * IPv4-first preference — so `preferred` can differ from `addresses[0]`, which
 * is the whole reason the field exists.
 */
function resolved(addresses: string[]) {
  const preferred = addresses.find((address) => address.includes('.')) ?? addresses[0]
  return { addresses, preferred }
}

describe('validateUrlWithDNS address classification', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('drops a private co-record and pins the public one', async () => {
    // The gap this closes: one address used to be classified, so which record
    // got judged was a matter of resolver order.
    mockResolve.mockResolvedValue(resolved(['93.184.216.34', '10.0.0.5']))

    const result = await validateUrlWithDNS('https://mixed.example/api')

    expect(result.isValid).toBe(true)
    expect(result.resolvedIP).toBe('93.184.216.34')
  })

  it('rejects when every record is private', async () => {
    mockResolve.mockResolvedValue(resolved(['10.0.0.5', '192.168.1.9']))

    const result = await validateUrlWithDNS('https://internal.example/api')

    expect(result.isValid).toBe(false)
    expect(result.error).toContain('blocked IP address')
  })

  it('never pins an address the filter refused', async () => {
    // The private record sorts first AND is the IPv4 one, so a pin taken from
    // the unfiltered set would land on 10.0.0.5.
    mockResolve.mockResolvedValue(resolved(['10.0.0.5', '2606:2800:220:1::248']))

    const result = await validateUrlWithDNS('https://mixed.example/api')

    expect(result.isValid).toBe(true)
    expect(result.resolvedIP).toBe('2606:2800:220:1::248')
  })

  it('accepts a host whose every record is public, pinning the preferred one', async () => {
    mockResolve.mockResolvedValue(resolved(['93.184.216.34', '93.184.216.35']))

    const result = await validateUrlWithDNS('https://example.com/api')

    expect(result.isValid).toBe(true)
    expect(result.resolvedIP).toBe('93.184.216.34')
  })

  it('keeps the self-hosted localhost carve-out when every record is loopback', async () => {
    mockResolve.mockResolvedValue(resolved(['127.0.0.1', '::1']))

    expect((await validateUrlWithDNS('https://localhost/api')).isValid).toBe(true)
  })

  it('drops an off-loopback record from localhost rather than pinning it', async () => {
    // The carve-out covers loopback only, so the LAN record is filtered out and
    // the pin stays on the machine the carve-out was written for.
    mockResolve.mockResolvedValue(resolved(['127.0.0.1', '10.0.0.5']))

    const result = await validateUrlWithDNS('https://localhost/api')

    expect(result.isValid).toBe(true)
    expect(result.resolvedIP).toBe('127.0.0.1')
  })

  it('reports an unresolvable host rather than treating it as public', async () => {
    mockResolve.mockRejectedValue(new Error('ENOTFOUND'))

    expect((await validateUrlWithDNS('https://missing.example/api')).isValid).toBe(false)
  })
})
