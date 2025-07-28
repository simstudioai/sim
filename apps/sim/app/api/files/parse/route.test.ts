import path from 'path'
import { NextRequest } from 'next/server'
/**
 * Tests for file parse API route
 *
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockRequest, setupFileApiMocks } from '@/app/api/__test-utils__/utils'
import { POST } from '@/app/api/files/parse/route'

const mockJoin = vi.fn((...args: string[]): string => {
  if (args[0] === '/test/uploads') {
    return `/test/uploads/${args[args.length - 1]}`
  }
  return path.join(...args)
})

describe('File Parse API Route', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.resetAllMocks()

    vi.doMock('@/lib/file-parsers', () => ({
      isSupportedFileType: vi.fn().mockReturnValue(true),
      parseFile: vi.fn().mockResolvedValue({
        content: 'parsed content',
        metadata: { pageCount: 1 },
      }),
      parseBuffer: vi.fn().mockResolvedValue({
        content: 'parsed buffer content',
        metadata: { pageCount: 1 },
      }),
    }))

    vi.doMock('path', () => {
      return {
        ...path,
        join: mockJoin,
        basename: path.basename,
        extname: path.extname,
      }
    })

    vi.doMock('@/lib/uploads/setup.server', () => ({}))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should handle missing file path', async () => {
    setupFileApiMocks()

    const req = createMockRequest('POST', {})
    const { POST } = await import('@/app/api/files/parse/route')

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data).toHaveProperty('error', 'No file path provided')
  })

  it('should accept and process a local file', async () => {
    setupFileApiMocks({
      cloudEnabled: false,
      storageProvider: 'local',
    })

    const req = createMockRequest('POST', {
      filePath: '/api/files/serve/test-file.txt',
    })

    const { POST } = await import('@/app/api/files/parse/route')
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
    setupFileApiMocks({
      cloudEnabled: true,
      storageProvider: 's3',
    })

    const req = createMockRequest('POST', {
      filePath: '/api/files/serve/s3/test-file.pdf',
    })

    const { POST } = await import('@/app/api/files/parse/route')
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
    setupFileApiMocks({
      cloudEnabled: false,
      storageProvider: 'local',
    })

    const req = createMockRequest('POST', {
      filePath: ['/api/files/serve/file1.txt', '/api/files/serve/file2.txt'],
    })

    const { POST } = await import('@/app/api/files/parse/route')
    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toHaveProperty('success')
    expect(data).toHaveProperty('results')
    expect(Array.isArray(data.results)).toBe(true)
    expect(data.results).toHaveLength(2)
  })

  it('should handle S3 access errors gracefully', async () => {
    setupFileApiMocks({
      cloudEnabled: true,
      storageProvider: 's3',
    })

    // Override with error-throwing mock
    vi.doMock('@/lib/uploads', () => ({
      downloadFile: vi.fn().mockRejectedValue(new Error('Access denied')),
      isUsingCloudStorage: vi.fn().mockReturnValue(true),
      uploadFile: vi.fn().mockResolvedValue({
        path: '/api/files/serve/test-key',
        key: 'test-key',
        name: 'test.txt',
        size: 100,
        type: 'text/plain',
      }),
    }))

    const req = new NextRequest('http://localhost:3000/api/files/parse', {
      method: 'POST',
      body: JSON.stringify({
        filePath: '/api/files/serve/s3/test-file.txt',
      }),
    })

    const { POST } = await import('@/app/api/files/parse/route')
    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data).toHaveProperty('success', false)
    expect(data).toHaveProperty('error')
    expect(data.error).toContain('Access denied')
  })

  it('should handle access errors gracefully', async () => {
    setupFileApiMocks({
      cloudEnabled: false,
      storageProvider: 'local',
    })

    vi.doMock('fs/promises', () => ({
      access: vi.fn().mockRejectedValue(new Error('ENOENT: no such file')),
      stat: vi.fn().mockImplementation(() => ({ isFile: () => true })),
      readFile: vi.fn().mockResolvedValue(Buffer.from('test file content')),
      writeFile: vi.fn().mockResolvedValue(undefined),
    }))

    const req = createMockRequest('POST', {
      filePath: '/api/files/serve/nonexistent.txt',
    })

    const { POST } = await import('@/app/api/files/parse/route')
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
        'C:\\Windows\\System32\\drivers\\etc\\hosts',
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
            filePath: decodeURIComponent(maliciousPath),
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
