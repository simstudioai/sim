import { NextRequest } from 'next/server'
/**
 * Tests for file serve API route
 *
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setupApiTestMocks } from '@/app/api/__test-utils__/utils'

describe('File Serve API Route', () => {
  beforeEach(() => {
    vi.resetModules()

    setupApiTestMocks({
      withFileSystem: true,
      withUploadUtils: true,
    })

    vi.doMock('@/lib/auth/hybrid', () => ({
      checkHybridAuth: vi.fn().mockResolvedValue({
        success: true,
        userId: 'test-user-id',
      }),
    }))

    vi.doMock('@/app/api/files/authorization', () => ({
      verifyFileAccess: vi.fn().mockResolvedValue(true),
    }))

    vi.doMock('fs', () => ({
      existsSync: vi.fn().mockReturnValue(true),
    }))

    vi.doMock('@/app/api/files/utils', () => ({
      FileNotFoundError: class FileNotFoundError extends Error {
        constructor(message: string) {
          super(message)
          this.name = 'FileNotFoundError'
        }
      },
      createFileResponse: vi.fn().mockImplementation((file) => {
        return new Response(file.buffer, {
          status: 200,
          headers: {
            'Content-Type': file.contentType,
            'Content-Disposition': `inline; filename="${file.filename}"`,
          },
        })
      }),
      createErrorResponse: vi.fn().mockImplementation((error) => {
        return new Response(JSON.stringify({ error: error.name, message: error.message }), {
          status: error.name === 'FileNotFoundError' ? 404 : 500,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
      getContentType: vi.fn().mockReturnValue('text/plain'),
      extractStorageKey: vi.fn().mockImplementation((path) => path.split('/').pop()),
      extractFilename: vi.fn().mockImplementation((path) => path.split('/').pop()),
      findLocalFile: vi.fn().mockReturnValue('/test/uploads/test-file.txt'),
    }))

    vi.doMock('@/lib/uploads/setup.server', () => ({}))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should serve local file successfully', async () => {
    const req = new NextRequest(
      'http://localhost:3000/api/files/serve/workspace/test-workspace-id/test-file.txt'
    )
    const params = { path: ['workspace', 'test-workspace-id', 'test-file.txt'] }
    const { GET } = await import('@/app/api/files/serve/[...path]/route')

    const response = await GET(req, { params: Promise.resolve(params) })

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('text/plain')
    const disposition = response.headers.get('Content-Disposition')
    expect(disposition).toContain('inline')
    expect(disposition).toContain('filename=')
    expect(disposition).toContain('test-file.txt')

    const fs = await import('fs/promises')
    expect(fs.readFile).toHaveBeenCalled()
  })

  it('should handle nested paths correctly', async () => {
    vi.doMock('@/app/api/files/utils', () => ({
      FileNotFoundError: class FileNotFoundError extends Error {
        constructor(message: string) {
          super(message)
          this.name = 'FileNotFoundError'
        }
      },
      createFileResponse: vi.fn().mockImplementation((file) => {
        return new Response(file.buffer, {
          status: 200,
          headers: {
            'Content-Type': file.contentType,
            'Content-Disposition': `inline; filename="${file.filename}"`,
          },
        })
      }),
      createErrorResponse: vi.fn().mockImplementation((error) => {
        return new Response(JSON.stringify({ error: error.name, message: error.message }), {
          status: error.name === 'FileNotFoundError' ? 404 : 500,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
      getContentType: vi.fn().mockReturnValue('text/plain'),
      extractStorageKey: vi.fn().mockImplementation((path) => path.split('/').pop()),
      extractFilename: vi.fn().mockImplementation((path) => path.split('/').pop()),
      findLocalFile: vi.fn().mockReturnValue('/test/uploads/nested/path/file.txt'),
    }))

    vi.doMock('@/lib/auth/hybrid', () => ({
      checkHybridAuth: vi.fn().mockResolvedValue({
        success: true,
        userId: 'test-user-id',
      }),
    }))

    vi.doMock('@/app/api/files/authorization', () => ({
      verifyFileAccess: vi.fn().mockResolvedValue(true),
    }))

    const req = new NextRequest(
      'http://localhost:3000/api/files/serve/workspace/test-workspace-id/nested-path-file.txt'
    )
    const params = { path: ['workspace', 'test-workspace-id', 'nested-path-file.txt'] }
    const { GET } = await import('@/app/api/files/serve/[...path]/route')

    const response = await GET(req, { params: Promise.resolve(params) })

    expect(response.status).toBe(200)

    const fs = await import('fs/promises')
    expect(fs.readFile).toHaveBeenCalledWith('/test/uploads/nested/path/file.txt')
  })

  it('should serve cloud file by downloading and proxying', async () => {
    const downloadFileMock = vi.fn().mockResolvedValue(Buffer.from('test cloud file content'))

    vi.doMock('@/lib/uploads', () => ({
      StorageService: {
        downloadFile: downloadFileMock,
        generatePresignedDownloadUrl: vi
          .fn()
          .mockResolvedValue('https://example-s3.com/presigned-url'),
        hasCloudStorage: vi.fn().mockReturnValue(true),
      },
      isUsingCloudStorage: vi.fn().mockReturnValue(true),
    }))

    vi.doMock('@/lib/uploads/core/storage-service', () => ({
      downloadFile: downloadFileMock,
      hasCloudStorage: vi.fn().mockReturnValue(true),
    }))

    vi.doMock('@/lib/uploads/setup', () => ({
      UPLOAD_DIR: '/test/uploads',
      USE_S3_STORAGE: true,
      USE_BLOB_STORAGE: false,
    }))

    vi.doMock('@/lib/auth/hybrid', () => ({
      checkHybridAuth: vi.fn().mockResolvedValue({
        success: true,
        userId: 'test-user-id',
      }),
    }))

    vi.doMock('@/app/api/files/authorization', () => ({
      verifyFileAccess: vi.fn().mockResolvedValue(true),
    }))

    vi.doMock('@/app/api/files/utils', () => ({
      FileNotFoundError: class FileNotFoundError extends Error {
        constructor(message: string) {
          super(message)
          this.name = 'FileNotFoundError'
        }
      },
      createFileResponse: vi.fn().mockImplementation((file) => {
        return new Response(file.buffer, {
          status: 200,
          headers: {
            'Content-Type': file.contentType,
            'Content-Disposition': `inline; filename="${file.filename}"`,
          },
        })
      }),
      createErrorResponse: vi.fn().mockImplementation((error) => {
        return new Response(JSON.stringify({ error: error.name, message: error.message }), {
          status: error.name === 'FileNotFoundError' ? 404 : 500,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
      getContentType: vi.fn().mockReturnValue('image/png'),
      extractStorageKey: vi.fn().mockImplementation((path) => path.split('/').pop()),
      extractFilename: vi.fn().mockImplementation((path) => path.split('/').pop()),
      findLocalFile: vi.fn().mockReturnValue('/test/uploads/test-file.txt'),
    }))

    const req = new NextRequest(
      'http://localhost:3000/api/files/serve/workspace/test-workspace-id/1234567890-image.png'
    )
    const params = { path: ['workspace', 'test-workspace-id', '1234567890-image.png'] }
    const { GET } = await import('@/app/api/files/serve/[...path]/route')

    const response = await GET(req, { params: Promise.resolve(params) })

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('image/png')

    expect(downloadFileMock).toHaveBeenCalledWith({
      key: 'workspace/test-workspace-id/1234567890-image.png',
      context: 'workspace',
    })
  })

  it('should return 404 when file not found', async () => {
    vi.doMock('fs', () => ({
      existsSync: vi.fn().mockReturnValue(false),
    }))

    vi.doMock('fs/promises', () => ({
      readFile: vi.fn().mockRejectedValue(new Error('ENOENT: no such file or directory')),
    }))

    vi.doMock('@/lib/auth/hybrid', () => ({
      checkHybridAuth: vi.fn().mockResolvedValue({
        success: true,
        userId: 'test-user-id',
      }),
    }))

    vi.doMock('@/app/api/files/authorization', () => ({
      verifyFileAccess: vi.fn().mockResolvedValue(false), // File not found = no access
    }))

    vi.doMock('@/app/api/files/utils', () => ({
      FileNotFoundError: class FileNotFoundError extends Error {
        constructor(message: string) {
          super(message)
          this.name = 'FileNotFoundError'
        }
      },
      createFileResponse: vi.fn(),
      createErrorResponse: vi.fn().mockImplementation((error) => {
        return new Response(JSON.stringify({ error: error.name, message: error.message }), {
          status: error.name === 'FileNotFoundError' ? 404 : 500,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
      getContentType: vi.fn().mockReturnValue('text/plain'),
      extractStorageKey: vi.fn(),
      extractFilename: vi.fn(),
      findLocalFile: vi.fn().mockReturnValue(null),
    }))

    const req = new NextRequest(
      'http://localhost:3000/api/files/serve/workspace/test-workspace-id/nonexistent.txt'
    )
    const params = { path: ['workspace', 'test-workspace-id', 'nonexistent.txt'] }
    const { GET } = await import('@/app/api/files/serve/[...path]/route')

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
        vi.doMock('@/lib/auth/hybrid', () => ({
          checkHybridAuth: vi.fn().mockResolvedValue({
            success: true,
            userId: 'test-user-id',
          }),
        }))

        vi.doMock('@/app/api/files/authorization', () => ({
          verifyFileAccess: vi.fn().mockResolvedValue(true),
        }))

        vi.doMock('@/app/api/files/utils', () => ({
          FileNotFoundError: class FileNotFoundError extends Error {
            constructor(message: string) {
              super(message)
              this.name = 'FileNotFoundError'
            }
          },
          getContentType: () => test.contentType,
          findLocalFile: () => `/test/uploads/file.${test.ext}`,
          createFileResponse: (obj: { buffer: Buffer; contentType: string; filename: string }) =>
            new Response(obj.buffer as any, {
              status: 200,
              headers: {
                'Content-Type': obj.contentType,
                'Content-Disposition': `inline; filename="${obj.filename}"`,
                'Cache-Control': 'public, max-age=31536000',
              },
            }),
          createErrorResponse: () => new Response(null, { status: 404 }),
        }))

        const req = new NextRequest(
          `http://localhost:3000/api/files/serve/workspace/test-workspace-id/file.${test.ext}`
        )
        const params = { path: ['workspace', 'test-workspace-id', `file.${test.ext}`] }
        const { GET } = await import('@/app/api/files/serve/[...path]/route')

        const response = await GET(req, { params: Promise.resolve(params) })

        expect(response.headers.get('Content-Type')).toBe(test.contentType)
      })
    }
  })
})
