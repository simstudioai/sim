/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PayloadSizeLimitError } from '@/lib/core/utils/stream-limits'

const mocks = vi.hoisted(() => ({
  secureFetchWithPinnedIP: vi.fn(),
  validateUrlWithDNS: vi.fn(),
}))

vi.mock('@/lib/core/security/input-validation.server', () => ({
  secureFetchWithPinnedIP: mocks.secureFetchWithPinnedIP,
  validateUrlWithDNS: mocks.validateUrlWithDNS,
}))

vi.mock('@/lib/uploads/shared/types', () => ({ MAX_BUFFERED_TRANSFER_BYTES: 5 }))

import { getZoomMeetingRecordings } from '@/lib/internal/zoom/operations'

describe('getZoomMeetingRecordings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.validateUrlWithDNS.mockResolvedValue({ isValid: true, resolvedIP: '203.0.113.1' })
  })

  it('downloads sequentially and rejects cumulative recording bytes', async () => {
    mocks.secureFetchWithPinnedIP
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
    expect(mocks.secureFetchWithPinnedIP).toHaveBeenCalledTimes(3)
    expect(mocks.secureFetchWithPinnedIP).toHaveBeenNthCalledWith(
      3,
      'https://files.example/two',
      '203.0.113.1',
      expect.objectContaining({ maxResponseBytes: 2 })
    )
  })

  it('streams each recording within the remaining aggregate byte budget', async () => {
    mocks.secureFetchWithPinnedIP
      .mockResolvedValueOnce(
        Response.json({
          recording_files: [{ id: 'one', download_url: 'https://files.example/one' }],
        })
      )
      .mockRejectedValueOnce(
        new PayloadSizeLimitError({
          label: 'response body',
          maxBytes: 5,
          observedBytes: 6,
        })
      )

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
    expect(mocks.secureFetchWithPinnedIP).toHaveBeenNthCalledWith(
      2,
      'https://files.example/one',
      '203.0.113.1',
      expect.objectContaining({ maxResponseBytes: 5 })
    )
  })
})
