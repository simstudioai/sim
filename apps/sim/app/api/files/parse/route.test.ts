import path from 'path'
import { NextRequest } from 'next/server'
/**
 * Tests for file parse API route
 *
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockRequest } from '@/app/api/__test-utils__/utils'
import { POST } from './route'

const mockJoin = vi.fn((...args: string[]): string => {
  if (args[0] === '/test/uploads') {
    return `/test/uploads/${args[args.length - 1]}`
  }
  return path.join(...args)
})

describe('File Parse API Route', () => {
  const mockReadFile = vi.fn().mockResolvedValue(Buffer.from('test file content'))
  const mockWriteFile = vi.fn().mockResolvedValue(undefined)
  const mockUnlink = vi.fn().mockResolvedValue(undefined)
  const mockAccessFs = vi.fn().mockResolvedValue(undefined)
  const mockStatFs = vi.fn().mockImplementation(() => ({ isFile: () => true }))
  const mockDownloadFromS3 = vi.fn().mockResolvedValue(Buffer.from('test s3 file content'))
  const mockParseFile = vi.fn().mockResolvedValue({
    content: 'parsed content',
    metadata: { pageCount: 1 },
  })
  const mockParseBuffer = vi.fn().mockResolvedValue({
    content: 'parsed buffer content',
    metadata: { pageCount: 1 },
  })

  beforeEach(() => {
    vi.resetModules()

    vi.resetAllMocks()

    mockReadFile.mockResolvedValue(Buffer.from('test file content'))
    mockAccessFs.mockResolvedValue(undefined)
    mockStatFs.mockImplementation(() => ({ isFile: () => true }))

    vi.doMock('fs', () => ({
      existsSync: vi.fn().mockReturnValue(true),
      constants: { R_OK: 4 },
      promises: {
        access: mockAccessFs,
        stat: mockStatFs,
        readFile: mockReadFile,
      },
    }))

    vi.doMock('fs/promises', () => ({
      readFile: mockReadFile,
      writeFile: mockWriteFile,
      unlink: mockUnlink,
      access: mockAccessFs,
      stat: mockStatFs,
    }))

    vi.doMock('@/lib/uploads/s3-client', () => ({
      downloadFromS3: mockDownloadFromS3,
    }))

    vi.doMock('@/lib/file-parsers', () => ({
      isSupportedFileType: vi.fn().mockReturnValue(true),
      parseFile: mockParseFile,
      parseBuffer: mockParseBuffer,
    }))

    vi.doMock('path', () => {
      return {
        ...path,
        join: mockJoin,
        basename: path.basename,
        extname: path.extname,
      }
    })

    vi.doMock('@/lib/logs/console-logger', () => ({
      createLogger: vi.fn().mockReturnValue({
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
      }),
    }))

    vi.doMock('@/lib/uploads/setup', () => ({
      UPLOAD_DIR: '/test/uploads',
      USE_S3_STORAGE: false,
      S3_CONFIG: {
        bucket: 'test-bucket',
        region: 'test-region',
      },
    }))

    vi.doMock('@/lib/uploads/setup.server', () => ({}))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should handle missing file path', async () => {
    const req = createMockRequest('POST', {})
    const { POST } = await import('./route')

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data).toHaveProperty('error', 'No file path provided')
  })

  it('should accept and process a local file', async () => {
    const req = createMockRequest('POST', {
      filePath: '/api/files/serve/test-file.txt',
    })

    const { POST } = await import('./route')
    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).not.toBeNull()

    if (data.success === true) {
      expect(data).toHaveProperty('output')
    } else {
      expect(data).toHaveProperty('error')
      expect(typeof data.error).toBe('string')
    }
  })

  it('should process S3 files', async () => {
    const req = createMockRequest('POST', {
      filePath: '/api/files/serve/s3/test-file.pdf',
    })

    const { POST } = await import('./route')
    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(200)

    if (data.success === true) {
      expect(data).toHaveProperty('output')
    } else {
      expect(data).toHaveProperty('error')
    }
  })

  it('should handle multiple files', async () => {
    const req = createMockRequest('POST', {
      filePath: ['/api/files/serve/file1.txt', '/api/files/serve/file2.txt'],
    })

    const { POST } = await import('./route')
    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toHaveProperty('success')
    expect(data).toHaveProperty('results')
    expect(Array.isArray(data.results)).toBe(true)
    expect(data.results).toHaveLength(2)
  })

  it('should handle S3 access errors gracefully', async () => {
    mockDownloadFromS3.mockRejectedValueOnce(new Error('S3 access denied'))

    const req = createMockRequest('POST', {
      filePath: '/api/files/serve/s3/access-denied.pdf',
    })

    const { POST } = await import('./route')
    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toHaveProperty('success', false)
    expect(data).toHaveProperty('error')
    expect(data.error).toContain('S3 access denied')
  })

  it('should handle access errors gracefully', async () => {
    mockAccessFs.mockRejectedValueOnce(new Error('ENOENT: no such file'))

    const req = createMockRequest('POST', {
      filePath: '/api/files/serve/nonexistent.txt',
    })

    const { POST } = await import('./route')
    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toHaveProperty('success')
    expect(data).toHaveProperty('error')
  })
})

describe('Files Parse API - Path Traversal Security', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Path Traversal Prevention', () => {
    it('should reject path traversal attempts with .. segments', async () => {
      const maliciousRequests = [
        '../../../etc/passwd',
        '/api/files/serve/../../../etc/passwd',
        '/api/files/serve/../../app.js',
        '/api/files/serve/../.env',
        'uploads/../../../etc/hosts',
      ]

      for (const maliciousPath of maliciousRequests) {
        const request = new NextRequest('http://localhost:3000/api/files/parse', {
          method: 'POST',
          body: JSON.stringify({
            filePath: maliciousPath,
          }),
        })

        const response = await POST(request)
        const result = await response.json()

        expect(result.success).toBe(false)
        expect(result.error).toMatch(/Access denied|Invalid path|Path outside allowed directory/)
      }
    })

    it('should reject paths with tilde characters', async () => {
      const maliciousPaths = [
        '~/../../etc/passwd',
        '/api/files/serve/~/secret.txt',
        '~root/.ssh/id_rsa',
      ]

      for (const maliciousPath of maliciousPaths) {
        const request = new NextRequest('http://localhost:3000/api/files/parse', {
          method: 'POST',
          body: JSON.stringify({
            filePath: maliciousPath,
          }),
        })

        const response = await POST(request)
        const result = await response.json()

        expect(result.success).toBe(false)
        expect(result.error).toMatch(/Access denied|Invalid path/)
      }
    })

    it('should reject absolute paths outside upload directory', async () => {
      const maliciousPaths = [
        '/etc/passwd',
        '/root/.bashrc',
        '/app/.env',
        '/var/log/auth.log',
        'C:\\Windows\\System32\\drivers\\etc\\hosts', // Windows path
      ]

      for (const maliciousPath of maliciousPaths) {
        const request = new NextRequest('http://localhost:3000/api/files/parse', {
          method: 'POST',
          body: JSON.stringify({
            filePath: maliciousPath,
          }),
        })

        const response = await POST(request)
        const result = await response.json()

        expect(result.success).toBe(false)
        expect(result.error).toMatch(/Access denied|Path outside allowed directory/)
      }
    })

    it('should allow valid paths within upload directory', async () => {
      // Test that valid paths don't trigger path validation errors
      const validPaths = [
        '/api/files/serve/document.txt',
        '/api/files/serve/folder/file.pdf',
        '/api/files/serve/subfolder/image.png',
      ]

      for (const validPath of validPaths) {
        const request = new NextRequest('http://localhost:3000/api/files/parse', {
          method: 'POST',
          body: JSON.stringify({
            filePath: validPath,
          }),
        })

        const response = await POST(request)
        const result = await response.json()

        // Should not fail due to path validation (may fail for other reasons like file not found)
        if (result.error) {
          expect(result.error).not.toMatch(
            /Access denied|Path outside allowed directory|Invalid path/
          )
        }
      }
    })

    it('should handle encoded path traversal attempts', async () => {
      const encodedMaliciousPaths = [
        '/api/files/serve/%2e%2e%2f%2e%2e%2fetc%2fpasswd', // ../../../etc/passwd
        '/api/files/serve/..%2f..%2f..%2fetc%2fpasswd',
        '/api/files/serve/%2e%2e/%2e%2e/etc/passwd',
      ]

      for (const maliciousPath of encodedMaliciousPaths) {
        const request = new NextRequest('http://localhost:3000/api/files/parse', {
          method: 'POST',
          body: JSON.stringify({
            filePath: decodeURIComponent(maliciousPath), // Simulate URL decoding
          }),
        })

        const response = await POST(request)
        const result = await response.json()

        expect(result.success).toBe(false)
        expect(result.error).toMatch(/Access denied|Invalid path|Path outside allowed directory/)
      }
    })

    it('should handle null byte injection attempts', async () => {
      const nullBytePaths = [
        '/api/files/serve/file.txt\0../../etc/passwd',
        'file.txt\0/etc/passwd',
        '/api/files/serve/document.pdf\0/var/log/auth.log',
      ]

      for (const maliciousPath of nullBytePaths) {
        const request = new NextRequest('http://localhost:3000/api/files/parse', {
          method: 'POST',
          body: JSON.stringify({
            filePath: maliciousPath,
          }),
        })

        const response = await POST(request)
        const result = await response.json()

        expect(result.success).toBe(false)
        // Should be rejected either by path validation or file system access
      }
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty file paths', async () => {
      const request = new NextRequest('http://localhost:3000/api/files/parse', {
        method: 'POST',
        body: JSON.stringify({
          filePath: '',
        }),
      })

      const response = await POST(request)
      const result = await response.json()

      expect(response.status).toBe(400)
      expect(result.error).toBe('No file path provided')
    })

    it('should handle missing filePath parameter', async () => {
      const request = new NextRequest('http://localhost:3000/api/files/parse', {
        method: 'POST',
        body: JSON.stringify({}),
      })

      const response = await POST(request)
      const result = await response.json()

      expect(response.status).toBe(400)
      expect(result.error).toBe('No file path provided')
    })
  })
})
