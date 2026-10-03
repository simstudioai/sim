import {
  inputValidationMock,
  inputValidationMockFns,
} from '@sim/testing/mocks/input-validation.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)

const { mockSecureFetchWithPinnedIP, mockValidateUrlWithDNS } = inputValidationMockFns

import { requestGoogleDrive } from '@/lib/internal/google-drive/client'

describe('requestGoogleDrive', () => {
  beforeEach(() => {
    mockValidateUrlWithDNS.mockResolvedValue({ isValid: true, resolvedIP: '93.184.216.34' })
    mockSecureFetchWithPinnedIP.mockResolvedValue({ ok: true })
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

    expect(mockValidateUrlWithDNS).toHaveBeenCalledWith(
      'https://www.googleapis.com/drive/v3/files/file-1',
      'metadataUrl',
      'configuredEndpoint'
    )
    expect(mockSecureFetchWithPinnedIP).toHaveBeenCalledWith(
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
    mockValidateUrlWithDNS.mockResolvedValue({ isValid: false, error: 'URL blocked' })

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
    expect(mockSecureFetchWithPinnedIP).not.toHaveBeenCalled()
  })
})
