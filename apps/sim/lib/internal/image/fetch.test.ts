import {
  inputValidationMock,
  inputValidationMockFns,
} from '@sim/testing/mocks/input-validation.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)

const { mockSecureFetchWithPinnedIP, mockValidateUrlWithDNS } = inputValidationMockFns

import {
  fetchRemoteImage,
  MAX_REMOTE_IMAGE_BYTES,
  type RemoteImageFetchError,
} from '@/lib/internal/image/fetch'

describe('fetchRemoteImage', () => {
  beforeEach(() => {
    mockValidateUrlWithDNS.mockResolvedValue({ isValid: true, resolvedIP: '203.0.113.1' })
  })

  it('rejects an unsafe URL before issuing a request', async () => {
    mockValidateUrlWithDNS.mockResolvedValue({
      isValid: false,
      error: 'Private addresses are not allowed',
    })

    await expect(fetchRemoteImage('http://127.0.0.1/private.png')).rejects.toMatchObject<
      Partial<RemoteImageFetchError>
    >({ status: 403, message: 'Private addresses are not allowed' })
    expect(mockSecureFetchWithPinnedIP).not.toHaveBeenCalled()
  })

  it('maps an oversized response to 413', async () => {
    mockSecureFetchWithPinnedIP.mockResolvedValue(
      new Response('x', {
        headers: { 'Content-Length': String(MAX_REMOTE_IMAGE_BYTES + 1) },
      })
    )

    await expect(fetchRemoteImage('https://images.example.test/huge.png')).rejects.toMatchObject<
      Partial<RemoteImageFetchError>
    >({ status: 413 })
  })
})
