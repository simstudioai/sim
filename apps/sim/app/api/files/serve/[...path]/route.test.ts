/**
 * Tests for file serve API route
 *
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckSessionOrInternalAuth,
  mockVerifyFileAccess,
  mockReadFile,
  mockIsUsingCloudStorage,
  mockDownloadFile,
  mockDownloadCopilotFile,
  mockInferContextFromKey,
  mockGetContentType,
  mockFindLocalFile,
  mockCreateFileResponse,
  mockCreateErrorResponse,
  FileNotFoundError,
} = vi.hoisted(() => {
  class FileNotFoundErrorClass extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'FileNotFoundError'
    }
  }
  return {
    mockCheckSessionOrInternalAuth: vi.fn(),
    mockVerifyFileAccess: vi.fn(),
    mockReadFile: vi.fn(),
    mockIsUsingCloudStorage: vi.fn(),
    mockDownloadFile: vi.fn(),
    mockDownloadCopilotFile: vi.fn(),
    mockInferContextFromKey: vi.fn(),
    mockGetContentType: vi.fn(),
    mockFindLocalFile: vi.fn(),
    mockCreateFileResponse: vi.fn(),
    mockCreateErrorResponse: vi.fn(),
    FileNotFoundError: FileNotFoundErrorClass,
  }
})

vi.mock('fs/promises', () => ({
  readFile: mockReadFile,
  access: vi.fn().mockResolvedValue(undefined),
  stat: vi.fn().mockResolvedValue({ isFile: () => true, size: 100 }),
}))

vi.mock('@/lib/auth/hybrid', () => ({
  checkSessionOrInternalAuth: mockCheckSessionOrInternalAuth,
}))

vi.mock('@/app/api/files/authorization', () => ({
  verifyFileAccess: mockVerifyFileAccess,
}))

vi.mock('@/lib/uploads', () => ({
  CopilotFiles: {
    downloadCopilotFile: mockDownloadCopilotFile,
  },
  isUsingCloudStorage: mockIsUsingCloudStorage,
}))

vi.mock('@/lib/uploads/core/storage-service', () => ({
  downloadFile: mockDownloadFile,
  hasCloudStorage: vi.fn().mockReturnValue(true),
}))

vi.mock('@/lib/uploads/utils/file-utils', () => ({
  inferContextFromKey: mockInferContextFromKey,
}))

vi.mock('@/lib/uploads/setup.server', () => ({}))

vi.mock('@/app/api/files/utils', () => ({
  FileNotFoundError,
  createFileResponse: mockCreateFileResponse,
  createErrorResponse: mockCreateErrorResponse,
  getContentType: mockGetContentType,
  extractStorageKey: vi.fn().mockImplementation((path: string) => path.split('/').pop()),
  extractFilename: vi.fn().mockImplementation((path: string) => path.split('/').pop()),
  findLocalFile: mockFindLocalFile,
}))

import { GET } from '@/app/api/files/serve/[...path]/route'

describe('File Serve API Route', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'test-user-id',
    })
    mockVerifyFileAccess.mockResolvedValue(true)
    mockReadFile.mockResolvedValue(Buffer.from('test content'))
    mockIsUsingCloudStorage.mockReturnValue(false)
    mockInferContextFromKey.mockReturnValue('workspace')
    mockGetContentType.mockReturnValue('text/plain')
    mockFindLocalFile.mockReturnValue('/test/uploads/test-file.txt')
    mockCreateFileResponse.mockImplementation(
      (file: { buffer: Buffer; contentType: string; filename: string }) => {
        return new Response(file.buffer, {
          status: 200,
          headers: {
            'Content-Type': file.contentType,
            'Content-Disposition': `inline; filename="${file.filename}"`,
          },
        })
      }
    )
    mockCreateErrorResponse.mockImplementation((error: Error) => {
      return new Response(JSON.stringify({ error: error.name, message: error.message }), {
        status: error.name === 'FileNotFoundError' ? 404 : 500,
        headers: { 'Content-Type': 'application/json' },
      })
    })
  })

  it('should serve local file successfully', async () => {
    const req = new NextRequest(
      'http://localhost:3000/api/files/serve/workspace/test-workspace-id/test-file.txt'
    )
    const params = { path: ['workspace', 'test-workspace-id', 'test-file.txt'] }

    const response = await GET(req, { params: Promise.resolve(params) })

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('text/plain')
    const disposition = response.headers.get('Content-Disposition')
    expect(disposition).toContain('inline')
    expect(disposition).toContain('filename=')
    expect(disposition).toContain('test-file.txt')

    expect(mockReadFile).toHaveBeenCalled()
  })

  it('should handle nested paths correctly', async () => {
    mockFindLocalFile.mockReturnValue('/test/uploads/nested/path/file.txt')

    const req = new NextRequest(
      'http://localhost:3000/api/files/serve/workspace/test-workspace-id/nested-path-file.txt'
    )
    const params = { path: ['workspace', 'test-workspace-id', 'nested-path-file.txt'] }

    const response = await GET(req, { params: Promise.resolve(params) })

    expect(response.status).toBe(200)

    expect(mockReadFile).toHaveBeenCalledWith('/test/uploads/nested/path/file.txt')
  })

  it('should serve cloud file by downloading and proxying', async () => {
    mockIsUsingCloudStorage.mockReturnValue(true)
    mockDownloadFile.mockResolvedValue(Buffer.from('test cloud file content'))
    mockGetContentType.mockReturnValue('image/png')

    const req = new NextRequest(
      'http://localhost:3000/api/files/serve/workspace/test-workspace-id/1234567890-image.png'
    )
    const params = { path: ['workspace', 'test-workspace-id', '1234567890-image.png'] }

    const response = await GET(req, { params: Promise.resolve(params) })

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('image/png')

    expect(mockDownloadFile).toHaveBeenCalledWith({
      key: 'workspace/test-workspace-id/1234567890-image.png',
      context: 'workspace',
    })
  })

  it('should return 404 when file not found', async () => {
    mockVerifyFileAccess.mockResolvedValue(false)
    mockFindLocalFile.mockReturnValue(null)

    const req = new NextRequest(
      'http://localhost:3000/api/files/serve/workspace/test-workspace-id/nonexistent.txt'
    )
    const params = { path: ['workspace', 'test-workspace-id', 'nonexistent.txt'] }

    const response = await GET(req, { params: Promise.resolve(params) })

    expect(response.status).toBe(404)

    const responseData = await response.json()
    expect(responseData).toEqual({
      error: 'FileNotFoundError',
      message: expect.stringContaining('File not found'),
    })
  })

  describe('content type detection', () => {
    const contentTypeTests = [
      { ext: 'pdf', contentType: 'application/pdf' },
      { ext: 'json', contentType: 'application/json' },
      { ext: 'jpg', contentType: 'image/jpeg' },
      { ext: 'txt', contentType: 'text/plain' },
      { ext: 'unknown', contentType: 'application/octet-stream' },
    ]

    for (const test of contentTypeTests) {
      it(`should serve ${test.ext} file with correct content type`, async () => {
        mockGetContentType.mockReturnValue(test.contentType)
        mockFindLocalFile.mockReturnValue(`/test/uploads/file.${test.ext}`)
        mockCreateFileResponse.mockImplementation(
          (obj: { buffer: Buffer; contentType: string; filename: string }) =>
            new Response(obj.buffer, {
              status: 200,
              headers: {
                'Content-Type': obj.contentType,
                'Content-Disposition': `inline; filename="${obj.filename}"`,
                'Cache-Control': 'public, max-age=31536000',
              },
            })
        )

        const req = new NextRequest(
          `http://localhost:3000/api/files/serve/workspace/test-workspace-id/file.${test.ext}`
        )
        const params = { path: ['workspace', 'test-workspace-id', `file.${test.ext}`] }

        const response = await GET(req, { params: Promise.resolve(params) })

        expect(response.headers.get('Content-Type')).toBe(test.contentType)
      })
    }
  })
})
