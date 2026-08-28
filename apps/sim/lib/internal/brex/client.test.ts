/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_MAX_ERROR_BODY_BYTES } from '@/lib/core/utils/stream-limits'

const mocks = vi.hoisted(() => ({
  validateUrl: vi.fn(),
  pinnedFetch: vi.fn(),
  fetch: vi.fn(),
}))

vi.mock('@/lib/core/security/input-validation.server', () => ({
  validateUrlWithDNS: mocks.validateUrl,
  secureFetchWithPinnedIP: mocks.pinnedFetch,
}))

import { BrexReceiptClient, BrexReceiptError } from '@/lib/internal/brex/client'

describe('BrexReceiptClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mocks.fetch)
    mocks.validateUrl.mockResolvedValue({ isValid: true, resolvedIP: '52.216.0.1' })
  })

  it('uses the exact expense upload contract and forwards cancellation', async () => {
    const controller = new AbortController()
    mocks.fetch.mockResolvedValue(
      Response.json({ id: 'receipt-1', uri: 'https://upload.example/file' })
    )
    const target = await new BrexReceiptClient('token', controller.signal).createUploadTarget(
      'dinner.pdf',
      'expense/id'
    )

    expect(target).toEqual({ id: 'receipt-1', uri: 'https://upload.example/file' })
    expect(mocks.fetch).toHaveBeenCalledWith(
      'https://api.brex.com/v1/expenses/card/expense%2Fid/receipt_upload',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer token',
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ receipt_name: 'dinner.pdf' }),
        signal: controller.signal,
      }
    )
  })

  it('preserves Brex provider status and message', async () => {
    mocks.fetch.mockResolvedValue(Response.json({ message: 'Expense not found' }, { status: 404 }))
    const error = await new BrexReceiptClient('token')
      .createUploadTarget('receipt.pdf', 'expense-1')
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(BrexReceiptError)
    expect(error).toMatchObject({
      message: 'Brex API error (404): Expense not found',
      status: 404,
    })
  })

  it('pins the pre-signed upload and caps its response', async () => {
    const controller = new AbortController()
    mocks.pinnedFetch.mockResolvedValue(new Response(null, { status: 200 }))
    const buffer = Buffer.from('receipt')
    await new BrexReceiptClient('token', controller.signal).uploadReceipt(
      'https://upload.example/file',
      buffer
    )

    expect(mocks.pinnedFetch).toHaveBeenCalledWith('https://upload.example/file', '52.216.0.1', {
      method: 'PUT',
      headers: { 'Content-Length': String(buffer.byteLength) },
      body: new Uint8Array(buffer),
      maxResponseBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
      signal: controller.signal,
    })
  })

  it('rejects a provider upload URL that fails SSRF validation', async () => {
    mocks.validateUrl.mockResolvedValue({ isValid: false, error: 'blocked' })
    const error = await new BrexReceiptClient('token')
      .uploadReceipt('https://169.254.169.254/latest', Buffer.from('receipt'))
      .catch((caught: unknown) => caught)

    expect(error).toMatchObject({ message: 'Brex returned an invalid upload URL', status: 502 })
    expect(mocks.pinnedFetch).not.toHaveBeenCalled()
  })
})
