import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  secureFetch: vi.fn(),
  validateUrl: vi.fn(),
}))

vi.mock('@/lib/core/security/input-validation.server', () => ({
  MAX_JSON_API_RESPONSE_BYTES: 10 * 1024 * 1024,
  secureFetchWithPinnedIP: mocks.secureFetch,
  validateUrlWithDNS: mocks.validateUrl,
}))

import { requestGoogleDrive } from '@/lib/internal/google-drive/client'

describe('requestGoogleDrive', () => {
  beforeEach(() => {
    mocks.validateUrl.mockResolvedValue({ isValid: true, resolvedIP: '93.184.216.34' })
    mocks.secureFetch.mockResolvedValue({ ok: true })
  })

  it('pins the Google host and forwards credentials, caps, and cancellation', async () => {
    const controller = new AbortController()
    await requestGoogleDrive({
      accessToken: 'token',
      headers: { 'Content-Type': 'application/json' },
      label: 'metadataUrl',
      method: 'GET',
      signal: controller.signal,
      url: 'https://www.googleapis.com/drive/v3/files/file-1',
    })

    expect(mocks.validateUrl).toHaveBeenCalledWith(
      'https://www.googleapis.com/drive/v3/files/file-1',
      'metadataUrl',
      'configuredEndpoint'
    )
    expect(mocks.secureFetch).toHaveBeenCalledWith(
      'https://www.googleapis.com/drive/v3/files/file-1',
      '93.184.216.34',
      expect.objectContaining({
        headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
        maxResponseBytes: 10 * 1024 * 1024,
        redirectPolicy: {
          mode: 'standard',
          sendCredentialsOnCrossOriginRedirect: false,
        },
        signal: controller.signal,
      })
    )
  })

  it('fails closed before fetching when URL validation fails', async () => {
    mocks.validateUrl.mockResolvedValue({ isValid: false, error: 'URL blocked' })

    await expect(
      requestGoogleDrive({
        accessToken: 'token',
        label: 'downloadUrl',
        url: 'https://www.googleapis.com/drive/v3/files/file-1',
      })
    ).rejects.toMatchObject({
      status: 400,
      body: { success: false, error: 'URL blocked' },
    })
    expect(mocks.secureFetch).not.toHaveBeenCalled()
  })
})
