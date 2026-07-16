/**
 * @vitest-environment node
 */
import { createMockRequest, hybridAuthMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PayloadSizeLimitError } from '@/lib/core/utils/stream-limits'

const {
  mockAssertToolFileAccess,
  mockComputeTikTokChunkPlan,
  mockGetStoredVideoSize,
  mockStreamStoredVideoToTikTok,
} = vi.hoisted(() => ({
  mockAssertToolFileAccess: vi.fn(),
  mockComputeTikTokChunkPlan: vi.fn(() => ({
    chunkSize: 10_000_000,
    totalChunkCount: 2,
  })),
  mockGetStoredVideoSize: vi.fn(),
  mockStreamStoredVideoToTikTok: vi.fn(),
}))

vi.mock('@/app/api/files/authorization', () => ({
  assertToolFileAccess: mockAssertToolFileAccess,
}))

vi.mock('@/app/api/tools/tiktok/publish-video/upload', () => ({
  computeTikTokChunkPlan: mockComputeTikTokChunkPlan,
  getStoredVideoSize: mockGetStoredVideoSize,
  streamStoredVideoToTikTok: mockStreamStoredVideoToTikTok,
  TIKTOK_MAX_VIDEO_BYTES: 250 * 1024 * 1024,
}))

import { POST } from '@/app/api/tools/tiktok/publish-video/route'

const file = {
  key: 'workspace/workspace-1/video.mp4',
  name: 'video.mp4',
  size: 1,
  type: 'video/mp4',
}

describe('POST /api/tools/tiktok/publish-video', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hybridAuthMockFns.mockCheckInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-1',
      authType: 'internal_jwt',
    })
    mockAssertToolFileAccess.mockResolvedValue(null)
    mockGetStoredVideoSize.mockResolvedValue(20_000_000)
    mockComputeTikTokChunkPlan.mockReturnValue({
      chunkSize: 10_000_000,
      totalChunkCount: 2,
    })
    mockStreamStoredVideoToTikTok.mockResolvedValue(undefined)
  })

  it('uses authoritative storage size for initialization and streaming', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        data: { publish_id: 'publish-1', upload_url: 'https://upload.example/video' },
        error: { code: 'ok' },
      })
    )
    vi.stubGlobal('fetch', fetchMock)
    const request = createMockRequest('POST', {
      accessToken: 'access-token',
      file,
    })

    const response = await POST(request)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      output: { publishId: 'publish-1' },
    })
    expect(mockGetStoredVideoSize).toHaveBeenCalledWith({
      key: file.key,
      context: 'workspace',
      signal: request.signal,
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
    expect(fetchMock.mock.calls[0][1]?.signal).toBe(request.signal)
    expect(mockStreamStoredVideoToTikTok).toHaveBeenCalledWith({
      key: file.key,
      context: 'workspace',
      uploadUrl: 'https://upload.example/video',
      totalBytes: 20_000_000,
      mimeType: 'video/mp4',
      requestId: 'mock-request-id',
      signal: request.signal,
    })
  })

  it('rejects legacy Direct Post mode instead of uploading as a draft', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const response = await POST(
      createMockRequest('POST', {
        accessToken: 'access-token',
        mode: 'direct',
        file,
      })
    )

    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(mockGetStoredVideoSize).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns 413 when the storage object exceeds the relay limit', async () => {
    mockGetStoredVideoSize.mockRejectedValue(
      new PayloadSizeLimitError({
        label: 'TikTok video upload',
        maxBytes: 250 * 1024 * 1024,
        observedBytes: 251 * 1024 * 1024,
      })
    )

    const response = await POST(
      createMockRequest('POST', {
        accessToken: 'access-token',
        file,
      })
    )

    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'Video exceeds the 250MB limit for file uploads.',
    })
  })
})
