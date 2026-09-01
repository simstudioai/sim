/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PayloadSizeLimitError } from '@/lib/core/utils/stream-limits'

const mocks = vi.hoisted(() => ({
  assertToolFileAccess: vi.fn(),
  computeTikTokChunkPlan: vi.fn(() => ({ chunkSize: 10_000_000, totalChunkCount: 2 })),
  getStoredVideoSize: vi.fn(),
  streamStoredVideoToTikTok: vi.fn(),
}))

vi.mock('@/app/api/files/authorization', () => ({
  assertToolFileAccess: mocks.assertToolFileAccess,
}))

vi.mock('@/lib/internal/tiktok/upload', () => ({
  computeTikTokChunkPlan: mocks.computeTikTokChunkPlan,
  getStoredVideoSize: mocks.getStoredVideoSize,
  streamStoredVideoToTikTok: mocks.streamStoredVideoToTikTok,
  TIKTOK_MAX_VIDEO_BYTES: 250 * 1024 * 1024,
}))

import { executeTikTokUploadVideoDraft } from '@/lib/internal/tiktok/operations'

const FILE = {
  key: 'workspace/workspace-1/video.mp4',
  name: 'video.mp4',
  size: 1,
  type: 'video/mp4',
}

describe('executeTikTokUploadVideoDraft', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.assertToolFileAccess.mockResolvedValue(null)
    mocks.getStoredVideoSize.mockResolvedValue(20_000_000)
    mocks.computeTikTokChunkPlan.mockReturnValue({
      chunkSize: 10_000_000,
      totalChunkCount: 2,
    })
    mocks.streamStoredVideoToTikTok.mockResolvedValue(undefined)
    vi.stubGlobal('fetch', vi.fn())
  })

  it('uses authoritative storage size for initialization and streaming', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        data: { publish_id: 'publish-1', upload_url: 'https://upload.example/video' },
        error: { code: 'ok' },
      })
    )
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    const response = await executeTikTokUploadVideoDraft(
      { accessToken: 'access-token', file: FILE },
      {
        userId: 'user-1',
        requestId: 'request-1',
        signal: controller.signal,
      }
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      output: { publishId: 'publish-1' },
    })
    expect(mocks.getStoredVideoSize).toHaveBeenCalledWith({
      key: FILE.key,
      context: 'workspace',
      signal: controller.signal,
    })
    const init = JSON.parse(fetchMock.mock.calls[0][1]?.body as string) as {
      source_info: Record<string, unknown>
    }
    expect(init.source_info).toEqual({
      source: 'FILE_UPLOAD',
      video_size: 20_000_000,
      chunk_size: 10_000_000,
      total_chunk_count: 2,
    })
    expect(mocks.streamStoredVideoToTikTok).toHaveBeenCalledWith({
      key: FILE.key,
      context: 'workspace',
      uploadUrl: 'https://upload.example/video',
      totalBytes: 20_000_000,
      mimeType: 'video/mp4',
      requestId: 'request-1',
      signal: controller.signal,
    })
  })

  it('returns 413 when the stored object exceeds the relay limit', async () => {
    mocks.getStoredVideoSize.mockRejectedValue(
      new PayloadSizeLimitError({
        label: 'TikTok video upload',
        maxBytes: 250 * 1024 * 1024,
        observedBytes: 251 * 1024 * 1024,
      })
    )

    const response = await executeTikTokUploadVideoDraft(
      { accessToken: 'access-token', file: FILE },
      { userId: 'user-1', requestId: 'request-1' }
    )

    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'Video exceeds the 250MB limit for file uploads.',
    })
  })

  it('does not start provider upload before file authorization', async () => {
    mocks.assertToolFileAccess.mockResolvedValue(
      Response.json({ success: false, error: 'Forbidden' }, { status: 403 })
    )

    const response = await executeTikTokUploadVideoDraft(
      { accessToken: 'access-token', file: FILE },
      { userId: 'user-1', requestId: 'request-1' }
    )

    expect(response.status).toBe(403)
    expect(mocks.getStoredVideoSize).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })
})
