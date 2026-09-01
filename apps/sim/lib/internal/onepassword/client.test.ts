/**
 * @vitest-environment node
 */
import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDnsLookup, mockSecureFetch, mockValidateUrlWithDNS } = vi.hoisted(() => ({
  mockDnsLookup: vi.fn(),
  mockSecureFetch: vi.fn(),
  mockValidateUrlWithDNS: vi.fn(),
}))

vi.mock('dns/promises', () => ({
  default: { lookup: mockDnsLookup },
}))
vi.mock('@/lib/core/security/input-validation.server', () => ({
  MAX_JSON_API_RESPONSE_BYTES: 10 * 1024 * 1024,
  secureFetchWithPinnedIP: mockSecureFetch,
  validateUrlWithDNS: mockValidateUrlWithDNS,
}))

import { connectRequest, validateConnectServerUrl } from '@/lib/internal/onepassword/client'

afterAll(resetEnvFlagsMock)

describe('validateConnectServerUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setEnvFlags({ isHosted: false })
  })

  it('delegates to the egress guard as a self-hosted service', async () => {
    mockValidateUrlWithDNS.mockResolvedValue({ isValid: true, resolvedIP: '10.0.0.9' })

    await expect(validateConnectServerUrl('http://connect.internal:8080')).resolves.toBe('10.0.0.9')

    // The profile is the whole policy decision: Connect is ordinarily deployed
    // inside a network, on plain HTTP, on an arbitrary port. Which addresses that
    // permits is the guard's contract, covered by its own tests rather than
    // restated here — this file used to carry a copy of them alongside a copy of
    // the implementation.
    expect(mockValidateUrlWithDNS).toHaveBeenCalledWith(
      'http://connect.internal:8080',
      '1Password server URL',
      'selfHostedService'
    )
  })

  it('surfaces the guard refusal verbatim', async () => {
    mockValidateUrlWithDNS.mockResolvedValue({
      isValid: false,
      error: '1Password server URL resolves to a private or reserved address (10.0.0.9).',
    })

    await expect(validateConnectServerUrl('http://connect.internal')).rejects.toThrow(
      'resolves to a private or reserved address (10.0.0.9)'
    )
  })
})

describe('connectRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setEnvFlags({ isHosted: false })
    mockValidateUrlWithDNS.mockResolvedValue({ isValid: true, resolvedIP: '8.8.8.8' })
    mockSecureFetch.mockResolvedValue({ ok: true, status: 200 })
  })

  it('pins the resolved server and applies the JSON byte cap and cancellation', async () => {
    const controller = new AbortController()

    await connectRequest({
      serverUrl: 'https://8.8.8.8',
      apiKey: 'not-a-real-connect-token',
      path: '/v1/vaults',
      method: 'POST',
      body: { title: 'Example' },
      signal: controller.signal,
    })

    expect(mockSecureFetch).toHaveBeenCalledWith('https://8.8.8.8/v1/vaults', '8.8.8.8', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer not-a-real-connect-token',
        'Content-Type': 'application/json',
      },
      body: '{"title":"Example"}',
      profile: 'selfHostedService',
      maxResponseBytes: 10 * 1024 * 1024,
      signal: controller.signal,
    })
  })

  it('does no DNS or provider work after cancellation', async () => {
    const controller = new AbortController()
    controller.abort(new DOMException('cancelled', 'AbortError'))

    await expect(
      connectRequest({
        serverUrl: 'https://connect.example.com',
        apiKey: 'not-a-real-connect-token',
        path: '/v1/vaults',
        method: 'GET',
        signal: controller.signal,
      })
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(mockDnsLookup).not.toHaveBeenCalled()
    expect(mockSecureFetch).not.toHaveBeenCalled()
  })
})
