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

import { executeInstagramTool } from '@/lib/internal/instagram/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

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
  vi.stubGlobal('fetch', mockFetch)
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

function request(
  input: Record<string, unknown>,
  overrides: Partial<InternalToolOperationCall> = {}
): InternalToolOperationCall {
  return {
    toolId: 'instagram_download_media',
    input,
    headers: new Headers(),
    context: {
      userId: 'user-1',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      executionId: 'execution-1',
      metadata: {},
    },
    requestId: 'request-1',
    signal: new AbortController().signal,
    ...overrides,
  }
}

describe('executeInstagramTool download media', () => {
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

    const response = await executeInstagramTool(
      request({
        accessToken: 'instagram-token',
        mediaId: 'carousel-1',
        filename: 'launch',
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

    const response = await executeInstagramTool(
      request({
        accessToken: 'instagram-token',
        mediaId: 'media-invalid-image',
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

  it('rolls back stored carousel files before propagating cancellation', async () => {
    const controller = new AbortController()
    mockFetch
      .mockResolvedValueOnce(
        Response.json({
          id: 'carousel-1',
          media_type: 'CAROUSEL_ALBUM',
          children: { data: [{ id: 'child-image' }, { id: 'child-cancelled' }] },
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          id: 'child-image',
          media_type: 'IMAGE',
          media_url: 'https://scontent.example.com/child-image.jpg',
        })
      )
      .mockImplementationOnce(async () => {
        controller.abort()
        throw controller.signal.reason
      })
    mockDownloadFileFromUrl.mockResolvedValueOnce(JPEG_BYTES)
    mockDeleteFiles.mockResolvedValueOnce({ deleted: 1, failed: [] })

    await expect(
      executeInstagramTool(
        request(
          { accessToken: 'instagram-token', mediaId: 'carousel-1', filename: 'launch' },
          { signal: controller.signal }
        )
      )
    ).rejects.toMatchObject({ name: 'AbortError' })

    const storedFile = executionFile('launch-1.jpg', 'image/jpeg', JPEG_BYTES.length)
    expect(mockDeleteFiles).toHaveBeenCalledWith([storedFile.key], 'execution')
    expect(mockDeleteFileMetadata).toHaveBeenCalledWith(storedFile.key)
  })
})
