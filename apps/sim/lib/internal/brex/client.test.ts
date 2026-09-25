import {
  inputValidationMock,
  inputValidationMockFns,
} from '@sim/testing/mocks/input-validation.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_MAX_ERROR_BODY_BYTES } from '@/lib/core/utils/stream-limits'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
}))

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)

const { mockSecureFetchWithPinnedIP, mockValidateUrlWithDNS } = inputValidationMockFns

import { BrexReceiptClient } from '@/lib/internal/brex/client'

describe('BrexReceiptClient', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mocks.fetch)
    mockValidateUrlWithDNS.mockResolvedValue({ isValid: true, resolvedIP: '52.216.0.1' })
  })

  it('pins the pre-signed upload and caps its response', async () => {
    const controller = new AbortController()
    mockSecureFetchWithPinnedIP.mockResolvedValue(new Response(null, { status: 200 }))
    const buffer = Buffer.from('receipt')
    await new BrexReceiptClient('token', controller.signal).uploadReceipt(
      'https://upload.example/file',
      buffer
    )

    expect(mockSecureFetchWithPinnedIP).toHaveBeenCalledWith(
      'https://upload.example/file',
      '52.216.0.1',
      {
        profile: 'contentFetch',
        method: 'PUT',
        headers: { 'Content-Length': String(buffer.byteLength) },
        body: new Uint8Array(buffer),
        maxResponseBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
        signal: controller.signal,
      }
    )
  })

  it('rejects a provider upload URL that fails SSRF validation', async () => {
    mockValidateUrlWithDNS.mockResolvedValue({ isValid: false, error: 'blocked' })
    const error = await new BrexReceiptClient('token')
      .uploadReceipt('https://169.254.169.254/latest', Buffer.from('receipt'))
      .catch((caught: unknown) => caught)

    expect(error).toMatchObject({ message: 'Brex returned an invalid upload URL', status: 502 })
    expect(mockSecureFetchWithPinnedIP).not.toHaveBeenCalled()
  })
})
