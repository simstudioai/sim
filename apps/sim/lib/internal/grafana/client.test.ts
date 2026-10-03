import {
  inputValidationMock,
  inputValidationMockFns,
} from '@sim/testing/mocks/input-validation.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)

const { mockSecureFetchWithPinnedIP, mockValidateUrlWithDNS } = inputValidationMockFns

import { GrafanaClient } from '@/lib/internal/grafana/client'

describe('GrafanaClient', () => {
  beforeEach(() => {
    mockValidateUrlWithDNS.mockResolvedValue({ isValid: true, resolvedIP: '203.0.113.10' })
    mockSecureFetchWithPinnedIP.mockResolvedValue({ ok: true, status: 200 })
  })

  it('pins the validated host and bounds every request', async () => {
    const controller = new AbortController()
    const client = new GrafanaClient(
      'https://grafana.example.com/',
      'glsa_token',
      '2',
      controller.signal
    )

    await client.request('/api/folders/folder-1', {
      method: 'PUT',
      body: { title: 'New title' },
      headers: { 'X-Disable-Provenance': 'true' },
    })

    expect(mockValidateUrlWithDNS).toHaveBeenCalledWith(
      'https://grafana.example.com/api/folders/folder-1',
      'baseUrl',
      'configuredEndpoint'
    )
    expect(mockSecureFetchWithPinnedIP).toHaveBeenCalledWith(
      'https://grafana.example.com/api/folders/folder-1',
      '203.0.113.10',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ title: 'New title' }),
        maxResponseBytes: 10 * 1024 * 1024,
        timeout: 30_000,
        stripAuthOnRedirect: true,
        signal: controller.signal,
        headers: expect.objectContaining({
          Authorization: 'Bearer glsa_token',
          'X-Grafana-Org-Id': '2',
          'X-Disable-Provenance': 'true',
        }),
      })
    )
  })

  it('rejects invalid destinations before sending credentials', async () => {
    mockValidateUrlWithDNS.mockResolvedValue({ isValid: false, error: 'private address' })
    const client = new GrafanaClient('http://127.0.0.1:3000', 'secret')

    await expect(client.request('/api/health', { method: 'GET' })).resolves.toEqual({
      success: false,
      error: 'Invalid Grafana baseUrl: private address',
    })
    expect(mockSecureFetchWithPinnedIP).not.toHaveBeenCalled()
  })
})
