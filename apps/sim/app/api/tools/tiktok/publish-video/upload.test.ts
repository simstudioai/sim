/**
 * @vitest-environment node
 */
import { Readable } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PayloadSizeLimitError } from '@/lib/core/utils/stream-limits'

const { mockBackoffWithJitter, mockDownloadFileStream, mockHeadObject, mockParseRetryAfter } =
  vi.hoisted(() => ({
    mockBackoffWithJitter: vi.fn(() => 0),
    mockDownloadFileStream: vi.fn(),
    mockHeadObject: vi.fn(),
    mockParseRetryAfter: vi.fn(() => 25),
  }))

vi.mock('@sim/utils/retry', () => ({
  backoffWithJitter: mockBackoffWithJitter,
  parseRetryAfter: mockParseRetryAfter,
}))

vi.mock('@/lib/uploads/core/storage-service', () => ({
  downloadFileStream: mockDownloadFileStream,
  headObject: mockHeadObject,
}))

import {
  computeTikTokChunkPlan,
  getStoredVideoSize,
  streamStoredVideoToTikTok,
  TIKTOK_MAX_VIDEO_BYTES,
} from '@/app/api/tools/tiktok/publish-video/upload'

const baseStreamOptions = {
  key: 'workspace/workspace-1/video.mp4',
  context: 'workspace' as const,
  uploadUrl: 'https://upload.example/video',
  mimeType: 'video/mp4',
  requestId: 'request-1',
}

describe('TikTok video upload streaming', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockBackoffWithJitter.mockReturnValue(0)
    mockParseRetryAfter.mockReturnValue(25)
  })

  it('uses provider metadata as the authoritative bounded size', async () => {
    mockHeadObject.mockResolvedValue({ size: 1234, contentType: 'video/mp4' })

    await expect(
      getStoredVideoSize({
        key: baseStreamOptions.key,
        context: baseStreamOptions.context,
        signal: new AbortController().signal,
      })
    ).resolves.toBe(1234)
    expect(mockDownloadFileStream).not.toHaveBeenCalled()
  })

  it('counts a stream without accumulating it when provider metadata is unavailable', async () => {
    mockHeadObject.mockResolvedValue(null)
    mockDownloadFileStream.mockResolvedValue(
      Readable.from([Buffer.alloc(3), Buffer.alloc(5), Buffer.alloc(7)])
    )

    await expect(
      getStoredVideoSize({
        key: baseStreamOptions.key,
        context: baseStreamOptions.context,
        signal: new AbortController().signal,
      })
    ).resolves.toBe(15)
  })

  it('rejects an oversized provider object before opening its body', async () => {
    mockHeadObject.mockResolvedValue({ size: TIKTOK_MAX_VIDEO_BYTES + 1 })

    await expect(
      getStoredVideoSize({
        key: baseStreamOptions.key,
        context: baseStreamOptions.context,
        signal: new AbortController().signal,
      })
    ).rejects.toBeInstanceOf(PayloadSizeLimitError)
    expect(mockDownloadFileStream).not.toHaveBeenCalled()
  })

  it('computes TikTok chunk counts with the final chunk absorbing the remainder', () => {
    expect(computeTikTokChunkPlan(4_000_000)).toEqual({
      chunkSize: 4_000_000,
      totalChunkCount: 1,
    })
    expect(computeTikTokChunkPlan(20_000_001)).toEqual({
      chunkSize: 10_000_000,
      totalChunkCount: 2,
    })
  })

  it('streams sequential chunks with exact 206 intermediate and 201 final ranges', async () => {
    const totalBytes = 20_000_001
    mockDownloadFileStream.mockResolvedValue(
      Readable.from([Buffer.alloc(7_000_000, 1), Buffer.alloc(13_000_001, 2)])
    )
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 206 }))
      .mockResolvedValueOnce(new Response(null, { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()

    await streamStoredVideoToTikTok({
      ...baseStreamOptions,
      totalBytes,
      signal: controller.signal,
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: 'PUT',
      signal: controller.signal,
      headers: {
        'Content-Length': '10000000',
        'Content-Range': 'bytes 0-9999999/20000001',
        'Content-Type': 'video/mp4',
      },
    })
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      method: 'PUT',
      signal: controller.signal,
      headers: {
        'Content-Length': '10000001',
        'Content-Range': 'bytes 10000000-20000000/20000001',
        'Content-Type': 'video/mp4',
      },
    })
  })

  it('retries only 5xx responses with the same bounded chunk', async () => {
    mockDownloadFileStream.mockResolvedValue(Readable.from([Buffer.from('video')]))
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('temporary one', { status: 500, headers: { 'Retry-After': '1' } })
      )
      .mockResolvedValueOnce(new Response('temporary two', { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)

    await streamStoredVideoToTikTok({
      ...baseStreamOptions,
      totalBytes: 5,
      signal: new AbortController().signal,
    })

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(mockParseRetryAfter).toHaveBeenCalledTimes(2)
    expect(mockBackoffWithJitter).toHaveBeenNthCalledWith(1, 1, 25)
    expect(mockBackoffWithJitter).toHaveBeenNthCalledWith(2, 2, 25)
    const uploadedBodies = fetchMock.mock.calls.map((call) =>
      Buffer.from(call[1]?.body as Uint8Array).toString('utf8')
    )
    expect(uploadedBodies).toEqual(['video', 'video', 'video'])
  })

  it('rejects a successful but protocol-invalid final status without retrying', async () => {
    mockDownloadFileStream.mockResolvedValue(Readable.from([Buffer.from('video')]))
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      streamStoredVideoToTikTok({
        ...baseStreamOptions,
        totalBytes: 5,
        signal: new AbortController().signal,
      })
    ).rejects.toThrow('expected HTTP 201, received HTTP 200')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('detects storage-size drift before sending the final chunk', async () => {
    mockDownloadFileStream.mockResolvedValue(Readable.from([Buffer.from('video-extra')]))
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      streamStoredVideoToTikTok({
        ...baseStreamOptions,
        totalBytes: 5,
        signal: new AbortController().signal,
      })
    ).rejects.toThrow('Stored video grew after its size was resolved')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
