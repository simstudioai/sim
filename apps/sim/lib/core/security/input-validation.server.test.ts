import { getMockLogger } from '@sim/testing/mocks/logger.mock'
import { describe, expect, it, vi } from 'vitest'

const { mockResolve } = vi.hoisted(() => ({
  mockResolve: vi.fn(),
}))

vi.mock('@sim/security/dns', () => ({
  resolveHostAddresses: mockResolve,
  preferIpv4: (addresses: string[]) =>
    addresses.find((address) => address.includes('.')) ?? addresses[0],
}))

import {
  secureFetchWithValidation,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'

const mockWarn = getMockLogger('InputValidation').warn
const egressWarn = getMockLogger('Egress').warn

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
  it('drops a private co-record and pins the public one', async () => {
    // The gap this closes: one address used to be classified, so which record
    // got judged was a matter of resolver order.
    mockResolve.mockResolvedValue(resolved(['93.184.216.34', '10.0.0.5']))

    const result = await validateUrlWithDNS(
      'https://mixed.example/api',
      'url',
      'configuredEndpoint'
    )

    expect(result.isValid).toBe(true)
    expect(result.resolvedIP).toBe('93.184.216.34')
  })

  it('rejects when every record is private', async () => {
    mockResolve.mockResolvedValue(resolved(['10.0.0.5', '192.168.1.9']))

    const result = await validateUrlWithDNS(
      'https://internal.example/api',
      'url',
      'configuredEndpoint'
    )

    expect(result.isValid).toBe(false)
    // The message now names the offending address and the setting that would
    // permit it, instead of the old undifferentiated 'blocked IP address'.
    expect(result.error).toContain('private or reserved address (10.0.0.5)')
    expect(result.error).toContain('EGRESS_ALLOWED_IP_RANGES')
  })

  it('never pins an address the filter refused', async () => {
    // The private record sorts first AND is the IPv4 one, so a pin taken from
    // the unfiltered set would land on 10.0.0.5.
    mockResolve.mockResolvedValue(resolved(['10.0.0.5', '2606:2800:220:1::248']))

    const result = await validateUrlWithDNS(
      'https://mixed.example/api',
      'url',
      'configuredEndpoint'
    )

    expect(result.isValid).toBe(true)
    expect(result.resolvedIP).toBe('2606:2800:220:1::248')
  })

  it('accepts a host whose every record is public, pinning the preferred one', async () => {
    mockResolve.mockResolvedValue(resolved(['93.184.216.34', '93.184.216.35']))

    const result = await validateUrlWithDNS('https://example.com/api', 'url', 'configuredEndpoint')

    expect(result.isValid).toBe(true)
    expect(result.resolvedIP).toBe('93.184.216.34')
  })

  it('keeps the self-hosted localhost carve-out when every record is loopback', async () => {
    mockResolve.mockResolvedValue(resolved(['127.0.0.1', '::1']))

    expect(
      (await validateUrlWithDNS('https://localhost/api', 'url', 'configuredEndpoint')).isValid
    ).toBe(true)
  })

  it('drops an off-loopback record from localhost rather than pinning it', async () => {
    // The carve-out covers loopback only, so the LAN record is filtered out and
    // the pin stays on the machine the carve-out was written for.
    mockResolve.mockResolvedValue(resolved(['127.0.0.1', '10.0.0.5']))

    const result = await validateUrlWithDNS('https://localhost/api', 'url', 'configuredEndpoint')

    expect(result.isValid).toBe(true)
    expect(result.resolvedIP).toBe('127.0.0.1')
  })

  it('reports an unresolvable host rather than treating it as public', async () => {
    mockResolve.mockRejectedValue(new Error('ENOTFOUND'))

    expect(
      (await validateUrlWithDNS('https://missing.example/api', 'url', 'configuredEndpoint')).isValid
    ).toBe(false)
  })

  it('retains resolver causes for retry classification without admitting the request', async () => {
    const cause = Object.assign(new Error('Temporary DNS failure'), { code: 'EAI_AGAIN' })
    mockResolve.mockRejectedValue(cause)
    await expect(
      secureFetchWithValidation('https://example.com/preview', {
        profile: 'contentFetch',
      })
    ).rejects.toMatchObject({ message: 'url hostname could not be resolved', cause })
  })

  it('can conceal credential-derived host details in validation logs', async () => {
    mockResolve.mockRejectedValue(new Error('DNS failure with credential-host-canary'))

    await validateUrlWithDNS(
      'https://credential-host-canary.example/api',
      'url',
      'configuredEndpoint',
      { logDetails: false }
    )

    expect(egressWarn).toHaveBeenCalledWith('DNS lookup failed', {
      profile: 'configuredEndpoint',
      paramName: 'url',
    })
    expect(JSON.stringify(mockWarn.mock.calls)).not.toContain('credential-host-canary')
    expect(JSON.stringify(egressWarn.mock.calls)).not.toContain('credential-host-canary')
  })

  it('forwards fetch cancellation through DNS preflight without treating it as a resolver failure', async () => {
    const controller = new AbortController()
    mockResolve.mockImplementationOnce(
      (_host, options) =>
        new Promise((_, reject) => {
          options.signal.addEventListener('abort', () => reject(options.signal.reason), {
            once: true,
          })
        })
    )
    const pending = secureFetchWithValidation('https://example.com/preview', {
      profile: 'contentFetch',
      signal: controller.signal,
    })
    const rejection = expect(pending).rejects.toThrow('Preview deadline')
    controller.abort(new Error('Preview deadline'))
    await rejection
    expect(mockResolve).toHaveBeenCalledWith('example.com', { signal: controller.signal })
    expect(mockWarn).not.toHaveBeenCalled()
    expect(egressWarn).not.toHaveBeenCalled()
  })
})
