/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  secureFetchWithPinnedIP: vi.fn(),
  validateUrlWithDNS: vi.fn(),
}))

vi.mock('@/lib/core/security/input-validation.server', () => ({
  MAX_JSON_API_RESPONSE_BYTES: 10 * 1024 * 1024,
  secureFetchWithPinnedIP: mocks.secureFetchWithPinnedIP,
  validateUrlWithDNS: mocks.validateUrlWithDNS,
}))

import { GrafanaClient } from '@/lib/internal/grafana/client'

describe('GrafanaClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.validateUrlWithDNS.mockResolvedValue({ isValid: true, resolvedIP: '203.0.113.10' })
    mocks.secureFetchWithPinnedIP.mockResolvedValue({ ok: true, status: 200 })
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

    expect(mocks.validateUrlWithDNS).toHaveBeenCalledWith(
      'https://grafana.example.com/api/folders/folder-1',
      'baseUrl',
      'configuredEndpoint'
    )
    expect(mocks.secureFetchWithPinnedIP).toHaveBeenCalledWith(
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
    mocks.validateUrlWithDNS.mockResolvedValue({ isValid: false, error: 'private address' })
    const client = new GrafanaClient('http://127.0.0.1:3000', 'secret')

    await expect(client.request('/api/health', { method: 'GET' })).resolves.toEqual({
      success: false,
      error: 'Invalid Grafana baseUrl: private address',
    })
    expect(mocks.secureFetchWithPinnedIP).not.toHaveBeenCalled()
  })

  it('stops before network work when cancelled', async () => {
    const controller = new AbortController()
    controller.abort(new DOMException('cancelled', 'AbortError'))
    const client = new GrafanaClient(
      'https://grafana.example.com',
      'secret',
      undefined,
      controller.signal
    )

    await expect(client.request('/api/health', { method: 'GET' })).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(mocks.validateUrlWithDNS).not.toHaveBeenCalled()
  })
})
