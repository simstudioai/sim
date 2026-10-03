import {
  inputValidationMock,
  inputValidationMockFns,
} from '@sim/testing/mocks/input-validation.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_FILE_SIZE } from '@/lib/uploads/utils/validation'

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)

import { SharePointClient } from '@/lib/internal/sharepoint/client'

const { mockValidateUrlWithDNS, mockSecureFetchWithPinnedIP } = inputValidationMockFns

describe('SharePointClient', () => {
  beforeEach(() => {
    mockValidateUrlWithDNS.mockResolvedValue({ isValid: true, resolvedIP: '20.190.128.1' })
  })

  it('pins Graph downloads, strips authorization on redirect, and enforces the file cap', async () => {
    const controller = new AbortController()
    mockSecureFetchWithPinnedIP.mockResolvedValue(
      new Response(Buffer.from('content'), { status: 200, headers: { 'content-length': '7' } })
    )

    const result = await new SharePointClient('token', controller.signal).download(
      'drive/id',
      'item id'
    )

    expect(result).toEqual(Buffer.from('content'))
    expect(mockSecureFetchWithPinnedIP).toHaveBeenCalledWith(
      'https://graph.microsoft.com/v1.0/drives/drive%2Fid/items/item%20id/content',
      '20.190.128.1',
      {
        headers: { Authorization: 'Bearer token' },
        stripAuthOnRedirect: true,
        profile: 'configuredEndpoint',
        maxResponseBytes: MAX_FILE_SIZE,
        signal: controller.signal,
      }
    )
  })
})
