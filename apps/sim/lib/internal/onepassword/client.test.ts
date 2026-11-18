import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import {
  inputValidationMock,
  inputValidationMockFns,
} from '@sim/testing/mocks/input-validation.mock'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDnsLookup } = vi.hoisted(() => ({
  mockDnsLookup: vi.fn(),
}))

vi.mock('dns/promises', () => ({
  default: { lookup: mockDnsLookup },
}))
vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)

import type { VaultOverview } from '@1password/sdk'
import { connectRequest, normalizeSdkVault } from '@/lib/internal/onepassword/client'

const { mockSecureFetchWithPinnedIP: mockSecureFetch, mockValidateUrlWithDNS } =
  inputValidationMockFns

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

describe('normalizeSdkVault', () => {
  it('maps the service-account vault overview instead of placeholder values', () => {
    const vault = {
      id: 'vault-1',
      title: 'Engineering',
      description: 'Shared engineering secrets',
      vaultType: 'transfer',
      activeItemCount: 12,
      contentVersion: 7,
      attributeVersion: 3,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-02-01T00:00:00Z'),
    } as unknown as VaultOverview

    expect(normalizeSdkVault(vault)).toEqual({
      id: 'vault-1',
      name: 'Engineering',
      description: 'Shared engineering secrets',
      attributeVersion: 3,
      contentVersion: 7,
      items: 12,
      type: 'TRANSFER',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-02-01T00:00:00.000Z',
    })
  })
})
