/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSecureFetchWithPinnedIP, mockValidateUrlWithDNS } = vi.hoisted(() => ({
  mockSecureFetchWithPinnedIP: vi.fn(),
  mockValidateUrlWithDNS: vi.fn(),
}))

vi.mock('@/lib/core/security/input-validation.server', () => ({
  secureFetchWithPinnedIP: mockSecureFetchWithPinnedIP,
  validateUrlWithDNS: mockValidateUrlWithDNS,
}))

import {
  fetchRemoteImage,
  MAX_REMOTE_IMAGE_BYTES,
  type RemoteImageFetchError,
} from '@/lib/internal/image/fetch'

describe('fetchRemoteImage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockValidateUrlWithDNS.mockResolvedValue({ isValid: true, resolvedIP: '203.0.113.1' })
  })

  it('validates, pins, bounds, and returns the image bytes', async () => {
    mockSecureFetchWithPinnedIP.mockResolvedValue(
      new Response(Buffer.from('image-bytes'), {
        headers: { 'Content-Type': 'image/png' },
      })
    )
    const controller = new AbortController()

    const result = await fetchRemoteImage(
      'https://images.example.test/generated.png',
      controller.signal
    )

    expect(result).toEqual({ buffer: Buffer.from('image-bytes'), contentType: 'image/png' })
    expect(mockSecureFetchWithPinnedIP).toHaveBeenCalledWith(
      'https://images.example.test/generated.png',
      '203.0.113.1',
      expect.objectContaining({
        method: 'GET',
        maxResponseBytes: MAX_REMOTE_IMAGE_BYTES,
        signal: controller.signal,
        headers: expect.not.objectContaining({ 'Accept-Encoding': expect.anything() }),
      })
    )
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

  it('preserves the upstream response status', async () => {
    mockSecureFetchWithPinnedIP.mockResolvedValue(
      new Response('missing', { status: 404, statusText: 'Not Found' })
    )

    await expect(fetchRemoteImage('https://images.example.test/missing.png')).rejects.toMatchObject<
      Partial<RemoteImageFetchError>
    >({ status: 404, message: 'Failed to fetch image: Not Found' })
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
