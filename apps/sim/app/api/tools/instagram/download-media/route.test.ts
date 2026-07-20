/**
 * @vitest-environment node
 */
import { createMockRequest, hybridAuthMockFns } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockDeleteFileMetadata,
  mockDeleteFiles,
  mockDownloadFileFromUrl,
  mockUploadExecutionFile,
  mockUploadCopilotFile,
} = vi.hoisted(() => ({
  mockDeleteFileMetadata: vi.fn(),
  mockDeleteFiles: vi.fn(),
  mockDownloadFileFromUrl: vi.fn(),
  mockUploadExecutionFile: vi.fn(),
  mockUploadCopilotFile: vi.fn(),
}))

vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  downloadFileFromUrl: mockDownloadFileFromUrl,
}))
vi.mock('@/lib/uploads/contexts/execution', () => ({
  uploadExecutionFile: mockUploadExecutionFile,
}))
vi.mock('@/lib/uploads/contexts/copilot', () => ({
  uploadCopilotFile: mockUploadCopilotFile,
}))
vi.mock('@/lib/uploads/core/storage-service', () => ({
  deleteFiles: mockDeleteFiles,
}))
vi.mock('@/lib/uploads/server/metadata', () => ({
  deleteFileMetadata: mockDeleteFileMetadata,
}))

import { PayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { MAX_FILE_SIZE } from '@/lib/uploads/utils/validation'
import { POST } from '@/app/api/tools/instagram/download-media/route'
import { instagramDownloadMediaTool } from '@/tools/instagram/download_media'

const mockFetch = vi.fn()
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0x01])

function executionFile(name: string, type: string, size: number) {
  return {
    id: `file-${name}`,
    name,
    url: `/api/files/serve/execution/${name}`,
    size,
    type,
    key: `execution/workflow-1/execution-1/${name}`,
    context: 'execution',
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', mockFetch)
  hybridAuthMockFns.mockCheckInternalAuth.mockResolvedValue({
    success: true,
    userId: 'user-1',
    authType: 'internal_jwt',
  })
  mockDownloadFileFromUrl.mockResolvedValue(Buffer.from('instagram-media'))
  mockDeleteFiles.mockResolvedValue({ deleted: 0, failed: [] })
  mockDeleteFileMetadata.mockResolvedValue(true)
  mockUploadExecutionFile.mockImplementation(
    async (
      _context: { workspaceId: string; workflowId: string; executionId: string },
      buffer: Buffer,
      name: string,
      type: string
    ) => executionFile(name, type, buffer.length)
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('POST /api/tools/instagram/download-media', () => {
  it('stores a single download as an execution-scoped UserFile', async () => {
    mockFetch.mockResolvedValueOnce(
      Response.json({
        id: 'media-1',
        media_type: 'IMAGE',
        media_url: 'https://scontent.example.com/media-1.jpg',
      })
    )
    mockDownloadFileFromUrl.mockResolvedValueOnce(JPEG_BYTES)

    const response = await POST(
      createMockRequest('POST', {
        accessToken: 'instagram-token',
        mediaId: 'media-1',
        filename: 'campaign-cover.png',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        executionId: 'execution-1',
      })
    )

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toEqual({
      success: true,
      output: {
        files: [executionFile('campaign-cover.jpg', 'image/jpeg', JPEG_BYTES.length)],
        mediaId: 'media-1',
        mediaType: 'IMAGE',
        downloadedCount: 1,
      },
    })
    expect(mockDownloadFileFromUrl).toHaveBeenCalledWith(
      'https://scontent.example.com/media-1.jpg',
      expect.objectContaining({
        maxBytes: MAX_FILE_SIZE,
        signal: expect.any(AbortSignal),
        userId: 'user-1',
      })
    )
    expect(mockUploadExecutionFile).toHaveBeenCalledWith(
      {
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        executionId: 'execution-1',
      },
      JPEG_BYTES,
      'campaign-cover.jpg',
      'image/jpeg',
      'user-1'
    )
    expect(mockUploadCopilotFile).not.toHaveBeenCalled()
  })

  it('downloads carousel children sequentially and preserves their order', async () => {
    mockFetch
      .mockResolvedValueOnce(
        Response.json({
          id: 'carousel-1',
          media_type: 'CAROUSEL_ALBUM',
          children: { data: [{ id: 'child-image' }, { id: 'child-video' }] },
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          id: 'child-image',
          media_type: 'IMAGE',
          media_url: 'https://scontent.example.com/child-image.jpg',
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          id: 'child-video',
          media_type: 'VIDEO',
          media_url: 'https://scontent.example.com/child-video.mp4',
        })
      )
    mockDownloadFileFromUrl
      .mockResolvedValueOnce(JPEG_BYTES)
      .mockResolvedValueOnce(Buffer.from('video'))

    const response = await POST(
      createMockRequest('POST', {
        accessToken: 'instagram-token',
        mediaId: 'carousel-1',
        filename: 'launch',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        executionId: 'execution-1',
      })
    )

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.output).toEqual({
      files: [
        executionFile('launch-1.jpg', 'image/jpeg', JPEG_BYTES.length),
        executionFile('launch-2.mp4', 'video/mp4', 5),
      ],
      mediaId: 'carousel-1',
      mediaType: 'CAROUSEL_ALBUM',
      downloadedCount: 2,
    })
    expect(mockDownloadFileFromUrl.mock.calls.map(([url]) => url)).toEqual([
      'https://scontent.example.com/child-image.jpg',
      'https://scontent.example.com/child-video.mp4',
    ])
    expect(mockUploadExecutionFile.mock.calls.map(([, , name]) => name)).toEqual([
      'launch-1.jpg',
      'launch-2.mp4',
    ])
    expect(mockUploadExecutionFile.mock.invocationCallOrder[0]).toBeLessThan(
      mockFetch.mock.invocationCallOrder[2]
    )
  })

  it('rolls back earlier carousel files when a later child cannot be downloaded', async () => {
    mockFetch
      .mockResolvedValueOnce(
        Response.json({
          id: 'carousel-1',
          media_type: 'CAROUSEL_ALBUM',
          children: { data: [{ id: 'child-image' }, { id: 'child-missing' }] },
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          id: 'child-image',
          media_type: 'IMAGE',
          media_url: 'https://scontent.example.com/child-image.jpg',
        })
      )
      .mockResolvedValueOnce(
        Response.json(
          { error: { message: 'The second carousel item is unavailable' } },
          { status: 404 }
        )
      )
    mockDownloadFileFromUrl.mockResolvedValueOnce(JPEG_BYTES)
    mockDeleteFiles.mockResolvedValueOnce({ deleted: 1, failed: [] })

    const response = await POST(
      createMockRequest('POST', {
        accessToken: 'instagram-token',
        mediaId: 'carousel-1',
        filename: 'launch',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        executionId: 'execution-1',
      })
    )

    const storedFile = executionFile('launch-1.jpg', 'image/jpeg', JPEG_BYTES.length)
    expect(response.status).toBe(404)
    expect(mockDeleteFiles).toHaveBeenCalledWith([storedFile.key], 'execution')
    expect(mockDeleteFileMetadata).toHaveBeenCalledWith(storedFile.key)
  })

  it('does not preserve an image MIME type when the downloaded bytes are not a raster image', async () => {
    mockFetch.mockResolvedValueOnce(
      Response.json({
        id: 'media-invalid-image',
        media_type: 'IMAGE',
        media_url: 'https://scontent.example.com/media-invalid-image.jpg',
      })
    )
    const invalidImage = Buffer.from('<html>not an image</html>')
    mockDownloadFileFromUrl.mockResolvedValueOnce(invalidImage)

    const response = await POST(
      createMockRequest('POST', {
        accessToken: 'instagram-token',
        mediaId: 'media-invalid-image',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        executionId: 'execution-1',
      })
    )

    expect(response.status).toBe(200)
    expect(mockUploadExecutionFile).toHaveBeenCalledWith(
      expect.any(Object),
      invalidImage,
      'instagram-media-invalid-image.bin',
      'application/octet-stream',
      'user-1'
    )
  })

  it('returns 413 when a media download exceeds the size cap', async () => {
    mockFetch.mockResolvedValueOnce(
      Response.json({
        id: 'media-large',
        media_type: 'VIDEO',
        media_url: 'https://scontent.example.com/media-large.mp4',
      })
    )
    mockDownloadFileFromUrl.mockRejectedValueOnce(
      new PayloadSizeLimitError({
        label: 'Instagram media download',
        maxBytes: MAX_FILE_SIZE,
        observedBytes: MAX_FILE_SIZE + 1,
      })
    )

    const response = await POST(
      createMockRequest('POST', {
        accessToken: 'instagram-token',
        mediaId: 'media-large',
      })
    )

    expect(response.status).toBe(413)
    expect(await response.json()).toEqual({
      success: false,
      error: 'Instagram media exceeds the 100 MB canonical User File limit',
    })
    expect(mockUploadExecutionFile).not.toHaveBeenCalled()
    expect(mockUploadCopilotFile).not.toHaveBeenCalled()
  })
})

describe('instagramDownloadMediaTool', () => {
  it('documents the canonical User File size limit', () => {
    expect(instagramDownloadMediaTool.description).toContain('100 MB max per file')
    expect(instagramDownloadMediaTool.outputs?.files.description).toContain('100 MB max each')
  })

  it('forwards execution context and returns canonical file-array output', async () => {
    const body = instagramDownloadMediaTool.request.body?.({
      accessToken: 'instagram-token',
      mediaId: 'media-1',
      filename: 'campaign-cover',
      _context: {
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        executionId: 'execution-1',
      },
    })
    expect(body).toEqual({
      accessToken: 'instagram-token',
      mediaId: 'media-1',
      filename: 'campaign-cover',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      executionId: 'execution-1',
    })

    const file = executionFile('campaign-cover.jpg', 'image/jpeg', 11)
    const result = await instagramDownloadMediaTool.transformResponse?.(
      Response.json({
        success: true,
        output: {
          files: [file],
          mediaId: 'media-1',
          mediaType: 'IMAGE',
          downloadedCount: 1,
        },
      }),
      {
        accessToken: 'instagram-token',
        mediaId: 'media-1',
      }
    )

    expect(result).toEqual({
      success: true,
      output: {
        files: [file],
        mediaId: 'media-1',
        mediaType: 'IMAGE',
        downloadedCount: 1,
      },
    })
    expect(instagramDownloadMediaTool.outputs?.files.type).toBe('file[]')
  })
})
