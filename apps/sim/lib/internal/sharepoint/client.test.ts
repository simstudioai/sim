/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_FILE_SIZE } from '@/lib/uploads/utils/validation'

const mocks = vi.hoisted(() => ({
  validateUrl: vi.fn(),
  pinnedFetch: vi.fn(),
  validatedFetch: vi.fn(),
}))

vi.mock('@/lib/core/security/input-validation.server', () => ({
  validateUrlWithDNS: mocks.validateUrl,
  secureFetchWithPinnedIP: mocks.pinnedFetch,
  secureFetchWithValidation: mocks.validatedFetch,
}))

import { SharePointClient } from '@/lib/internal/sharepoint/client'

describe('SharePointClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.validateUrl.mockResolvedValue({ isValid: true, resolvedIP: '20.190.128.1' })
  })

  it('pins Graph downloads, strips authorization on redirect, and enforces the file cap', async () => {
    const controller = new AbortController()
    mocks.pinnedFetch.mockResolvedValue(
      new Response(Buffer.from('content'), { status: 200, headers: { 'content-length': '7' } })
    )

    const result = await new SharePointClient('token', controller.signal).download(
      'drive/id',
      'item id'
    )

    expect(result).toEqual(Buffer.from('content'))
    expect(mocks.pinnedFetch).toHaveBeenCalledWith(
      'https://graph.microsoft.com/v1.0/drives/drive%2Fid/items/item%20id/content',
      '20.190.128.1',
      {
        headers: { Authorization: 'Bearer token' },
        stripAuthOnRedirect: true,
        maxResponseBytes: MAX_FILE_SIZE,
        signal: controller.signal,
      }
    )
  })

  it('passes cancellation into validated Graph uploads', async () => {
    const controller = new AbortController()
    mocks.validatedFetch.mockResolvedValue(
      Response.json({ id: 'item', name: 'file', webUrl: 'https://example.com', size: 4 })
    )
    const buffer = Buffer.from('file')
    await new SharePointClient('token', controller.signal).upload(
      'https://graph.microsoft.com/upload',
      buffer,
      'application/pdf'
    )

    expect(mocks.validatedFetch).toHaveBeenCalledWith(
      'https://graph.microsoft.com/upload',
      {
        method: 'PUT',
        headers: {
          Authorization: 'Bearer token',
          'Content-Type': 'application/pdf',
        },
        body: buffer,
        signal: controller.signal,
      },
      'uploadUrl'
    )
  })
})
