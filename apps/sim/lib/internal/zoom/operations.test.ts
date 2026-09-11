/**
 * @vitest-environment node
 */
import { assert, beforeEach, describe, expect, it, vi } from 'vitest'
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

import {
  isInternalToolFileResult,
  type StoredToolFile,
} from '@/lib/internal/tool-operations/file-result'
import { getZoomMeetingRecordings } from '@/lib/internal/zoom/operations'

describe('getZoomMeetingRecordings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.validateUrlWithDNS.mockResolvedValue({ isValid: true, resolvedIP: '203.0.113.1' })
  })

  it('returns stored recording references with the original recording metadata', async () => {
    mocks.secureFetchWithPinnedIP
      .mockResolvedValueOnce(
        Response.json({
          id: 'meeting-1',
          recording_files: [{ id: 'one', download_url: 'https://files.example/one' }],
        })
      )
      .mockResolvedValueOnce(new Response('one', { headers: { 'content-type': 'video/mp4' } }))

    const result = await getZoomMeetingRecordings(
      { accessToken: 'token', meetingId: 'meeting-1', downloadFiles: true },
      { requestId: 'request-1' }
    )

    assert(isInternalToolFileResult(result))
    expect(result.files).toEqual([
      { name: 'zoom-recording-one.mp4', mimeType: 'video/mp4', buffer: Buffer.from('one') },
    ])
    const storedFile: StoredToolFile = {
      id: 'stored-file-1',
      key: 'execution/stored-file-1',
      url: '/api/files/serve/stored-file-1',
      name: 'zoom-recording-one.mp4',
      type: 'video/mp4',
      mimeType: 'video/mp4',
      size: 3,
      context: 'execution',
    }
    expect(result.present([storedFile])).toMatchObject({
      success: true,
      output: {
        recording: { id: 'meeting-1', recording_files: [{ id: 'one' }] },
        files: [storedFile],
      },
    })
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
