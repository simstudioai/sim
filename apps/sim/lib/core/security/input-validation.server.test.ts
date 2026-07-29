/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockResolve } = vi.hoisted(() => ({ mockResolve: vi.fn() }))

vi.mock('@sim/security/dns', () => ({
  resolveHostAddresses: mockResolve,
}))

vi.mock('@/lib/core/config/env-flags', () => ({
  isHosted: false,
  isPrivateDatabaseHostsAllowed: false,
  getProxyUrl: () => undefined,
}))

import { validateUrlWithDNS } from '@/lib/core/security/input-validation.server'

/** Shapes a resolver answer the way `resolveHostAddresses` does. */
function resolved(addresses: string[]) {
  return { addresses, preferred: addresses[0] }
}

describe('validateUrlWithDNS address classification', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects a host that also publishes a private record', async () => {
    // The gap this closes: only one address used to be classified, so a host
    // publishing both got through whenever the public record sorted first.
    mockResolve.mockResolvedValue(resolved(['93.184.216.34', '10.0.0.5']))

    const result = await validateUrlWithDNS('https://mixed.example/api')

    expect(result.isValid).toBe(false)
    expect(result.error).toContain('blocked IP address')
  })

  it('rejects it regardless of which record comes first', async () => {
    mockResolve.mockResolvedValue(resolved(['10.0.0.5', '93.184.216.34']))

    expect((await validateUrlWithDNS('https://mixed.example/api')).isValid).toBe(false)
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

  it('denies localhost the carve-out when it also resolves off-loopback', async () => {
    // `localhost` pointing at the LAN as well is not the case the carve-out was
    // written for, and riding it there would reach another machine.
    mockResolve.mockResolvedValue(resolved(['127.0.0.1', '10.0.0.5']))

    expect((await validateUrlWithDNS('https://localhost/api')).isValid).toBe(false)
  })

  it('reports an unresolvable host rather than treating it as public', async () => {
    mockResolve.mockRejectedValue(new Error('ENOTFOUND'))

    expect((await validateUrlWithDNS('https://missing.example/api')).isValid).toBe(false)
  })
})
