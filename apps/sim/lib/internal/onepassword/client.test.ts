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

import { connectRequest } from '@/lib/internal/onepassword/client'

afterAll(resetEnvFlagsMock)

describe('connectRequest', () => {
  beforeEach(() => {
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
})
