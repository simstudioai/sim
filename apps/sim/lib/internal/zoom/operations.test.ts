import {
  inputValidationMock,
  inputValidationMockFns,
} from '@sim/testing/mocks/input-validation.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)

vi.mock('@/lib/uploads/shared/types', () => ({ MAX_BUFFERED_TRANSFER_BYTES: 5 }))

import { getZoomMeetingRecordings } from '@/lib/internal/zoom/operations'

const { mockValidateUrlWithDNS, mockSecureFetchWithPinnedIP } = inputValidationMockFns

describe('getZoomMeetingRecordings', () => {
  beforeEach(() => {
    mockValidateUrlWithDNS.mockResolvedValue({ isValid: true, resolvedIP: '203.0.113.1' })
  })

  it('downloads sequentially and rejects cumulative recording bytes', async () => {
    mockSecureFetchWithPinnedIP
      .mockResolvedValueOnce(
        Response.json({
          recording_files: [
            { id: 'one', download_url: 'https://files.example/one' },
            { id: 'two', download_url: 'https://files.example/two' },
          ],
        })
      )
      .mockResolvedValueOnce(new Response('one'))
      .mockResolvedValueOnce(new Response('two'))

    await expect(
      getZoomMeetingRecordings(
        {
          accessToken: 'token',
          meetingId: 'meeting-1',
          downloadFiles: true,
        },
        { requestId: 'request-1' }
      )
    ).rejects.toMatchObject({ status: 413 })
    expect(mockSecureFetchWithPinnedIP).toHaveBeenCalledTimes(3)
    expect(mockSecureFetchWithPinnedIP).toHaveBeenNthCalledWith(
      3,
      'https://files.example/two',
      '203.0.113.1',
      expect.objectContaining({ maxResponseBytes: 2 })
    )
  })
})
