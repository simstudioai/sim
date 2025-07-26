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
      isS3Path: vi.fn().mockReturnValue(false),
      isBlobPath: vi.fn().mockReturnValue(false),
      extractS3Key: vi.fn().mockImplementation((path) => path.split('/').pop()),
      extractBlobKey: vi.fn().mockImplementation((path) => path.split('/').pop()),
      extractFilename: vi.fn().mockImplementation((path) => path.split('/').pop()),
      findLocalFile: vi.fn().mockReturnValue('/test/uploads/test-file.txt'),
    }))

    vi.doMock('@/lib/uploads/setup.server', () => ({}))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should serve local file successfully', async () => {
    const req = new NextRequest('http://localhost:3000/api/files/serve/test-file.txt')
    const params = { path: ['test-file.txt'] }
    const { GET } = await import('@/app/api/files/serve/[...path]/route')

    const response = await GET(req, { params: Promise.resolve(params) })

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('text/plain')
    expect(response.headers.get('Content-Disposition')).toBe('inline; filename="test-file.txt"')

    const fs = await import('fs/promises')
    expect(fs.readFile).toHaveBeenCalledWith('/test/uploads/test-file.txt')
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
      isS3Path: vi.fn().mockReturnValue(false),
      isBlobPath: vi.fn().mockReturnValue(false),
      extractS3Key: vi.fn().mockImplementation((path) => path.split('/').pop()),
      extractBlobKey: vi.fn().mockImplementation((path) => path.split('/').pop()),
      extractFilename: vi.fn().mockImplementation((path) => path.split('/').pop()),
      findLocalFile: vi.fn().mockReturnValue('/test/uploads/nested/path/file.txt'),
    }))

    const req = new NextRequest('http://localhost:3000/api/files/serve/nested/path/file.txt')
    const params = { path: ['nested', 'path', 'file.txt'] }
    const { GET } = await import('@/app/api/files/serve/[...path]/route')

    const response = await GET(req, { params: Promise.resolve(params) })

    expect(response.status).toBe(200)

    const fs = await import('fs/promises')
    expect(fs.readFile).toHaveBeenCalledWith('/test/uploads/nested/path/file.txt')
  })

  it('should serve cloud file by downloading and proxying', async () => {
    vi.doMock('@/lib/uploads', () => ({
      downloadFile: vi.fn().mockResolvedValue(Buffer.from('test cloud file content')),
      getPresignedUrl: vi.fn().mockResolvedValue('https://example-s3.com/presigned-url'),
      isUsingCloudStorage: vi.fn().mockReturnValue(true),
    }))

    vi.doMock('@/lib/uploads/setup', () => ({
      UPLOAD_DIR: '/test/uploads',
      USE_S3_STORAGE: true,
      USE_BLOB_STORAGE: false,
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
      isS3Path: vi.fn().mockReturnValue(false),
      isBlobPath: vi.fn().mockReturnValue(false),
      extractS3Key: vi.fn().mockImplementation((path) => path.split('/').pop()),
      extractBlobKey: vi.fn().mockImplementation((path) => path.split('/').pop()),
      extractFilename: vi.fn().mockImplementation((path) => path.split('/').pop()),
      findLocalFile: vi.fn().mockReturnValue('/test/uploads/test-file.txt'),
    }))

    const req = new NextRequest('http://localhost:3000/api/files/serve/s3/1234567890-image.png')
    const params = { path: ['s3', '1234567890-image.png'] }
    const { GET } = await import('@/app/api/files/serve/[...path]/route')

    const response = await GET(req, { params: Promise.resolve(params) })

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('image/png')

    const uploads = await import('@/lib/uploads')
    expect(uploads.downloadFile).toHaveBeenCalledWith('1234567890-image.png')
  })

  it('should return 404 when file not found', async () => {
    vi.doMock('fs', () => ({
      existsSync: vi.fn().mockReturnValue(false),
    }))

    vi.doMock('fs/promises', () => ({
      readFile: vi.fn().mockRejectedValue(new Error('ENOENT: no such file or directory')),
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
      isS3Path: vi.fn().mockReturnValue(false),
      isBlobPath: vi.fn().mockReturnValue(false),
      extractS3Key: vi.fn(),
      extractBlobKey: vi.fn(),
      extractFilename: vi.fn(),
      findLocalFile: vi.fn().mockReturnValue(null),
    }))

    const req = new NextRequest('http://localhost:3000/api/files/serve/nonexistent.txt')
    const params = { path: ['nonexistent.txt'] }
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
        vi.doMock('@/app/api/files/utils', () => ({
          getContentType: () => test.contentType,
          findLocalFile: () => `/test/uploads/file.${test.ext}`,
          createFileResponse: (obj: { buffer: Buffer; contentType: string; filename: string }) =>
            new Response(obj.buffer, {
              status: 200,
              headers: {
                'Content-Type': obj.contentType,
                'Content-Disposition': `inline; filename="${obj.filename}"`,
                'Cache-Control': 'public, max-age=31536000',
              },
            }),
          createErrorResponse: () => new Response(null, { status: 404 }),
        }))

        const req = new NextRequest(`http://localhost:3000/api/files/serve/file.${test.ext}`)
        const params = { path: [`file.${test.ext}`] }
        const { GET } = await import('@/app/api/files/serve/[...path]/route')

        const response = await GET(req, { params: Promise.resolve(params) })

        expect(response.headers.get('Content-Type')).toBe(test.contentType)
      })
    }
  })
})
