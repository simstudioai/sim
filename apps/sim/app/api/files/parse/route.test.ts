import path from 'path'
import { NextRequest } from 'next/server'
/**
 * Tests for file parse API route
 *
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockRequest, setupFileApiMocks } from '@/app/api/__test-utils__/utils'

const mockJoin = vi.fn((...args: string[]): string => {
  if (args[0] === '/test/uploads') {
    return `/test/uploads/${args[args.length - 1]}`
  }
  return path.join(...args)
})

describe('File Parse API Route', () => {
  beforeEach(() => {
    vi.resetModules()

    setupFileApiMocks({
      authenticated: true,
    })

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
        default: path,
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
      authenticated: true,
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
      authenticated: true,
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
      authenticated: true,
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

  it('should process execution file URLs with context query param', async () => {
    setupFileApiMocks({
      cloudEnabled: true,
      storageProvider: 's3',
      authenticated: true,
    })

    const req = createMockRequest('POST', {
      filePath:
        '/api/files/serve/s3/6vzIweweXAS1pJ1mMSrr9Flh6paJpHAx/79dac297-5ebb-410b-b135-cc594dfcb361/c36afbb0-af50-42b0-9b23-5dae2d9384e8/Confirmation.pdf?context=execution',
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

  it('should process workspace file URLs with context query param', async () => {
    setupFileApiMocks({
      cloudEnabled: true,
      storageProvider: 's3',
      authenticated: true,
    })

    const req = createMockRequest('POST', {
      filePath:
        '/api/files/serve/s3/fa8e96e6-7482-4e3c-a0e8-ea083b28af55-be56ca4f-83c2-4559-a6a4-e25eb4ab8ee2_1761691045516-1ie5q86-Confirmation.pdf?context=workspace',
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

  it('should handle S3 access errors gracefully', async () => {
    setupFileApiMocks({
      cloudEnabled: true,
      storageProvider: 's3',
      authenticated: true,
    })

    const downloadFileMock = vi.fn().mockRejectedValue(new Error('Access denied'))

    vi.doMock('@/lib/uploads/core/storage-service', () => ({
      downloadFile: downloadFileMock,
      hasCloudStorage: vi.fn().mockReturnValue(true),
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

    expect(data).toBeDefined()
    expect(typeof data).toBe('object')
  })

  it('should handle access errors gracefully', async () => {
    setupFileApiMocks({
      cloudEnabled: false,
      storageProvider: 'local',
      authenticated: true,
    })

    vi.doMock('fs/promises', () => ({
      access: vi.fn().mockRejectedValue(new Error('ENOENT: no such file')),
      stat: vi.fn().mockImplementation(() => ({ isFile: () => true })),
      readFile: vi.fn().mockResolvedValue(Buffer.from('test file content')),
      writeFile: vi.fn().mockResolvedValue(undefined),
    }))

    const req = createMockRequest('POST', {
      filePath: 'nonexistent.txt',
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
    vi.resetModules()
    setupFileApiMocks({
      authenticated: true,
    })
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

        const { POST } = await import('@/app/api/files/parse/route')
        const response = await POST(request)
        const result = await response.json()

        expect(result.success).toBe(false)
        expect(result.error).toMatch(
          /Access denied|Invalid path|Path outside allowed directory|Unauthorized/
        )
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

        const { POST } = await import('@/app/api/files/parse/route')
        const response = await POST(request)
        const result = await response.json()

        expect(result.success).toBe(false)
        expect(result.error).toMatch(/Access denied|Invalid path|Unauthorized/)
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

        const { POST } = await import('@/app/api/files/parse/route')
        const response = await POST(request)
        const result = await response.json()

        expect(result.success).toBe(false)
        expect(result.error).toMatch(/Access denied|Path outside allowed directory|Unauthorized/)
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

        const { POST } = await import('@/app/api/files/parse/route')
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

        const { POST } = await import('@/app/api/files/parse/route')
        const response = await POST(request)
        const result = await response.json()

        expect(result.success).toBe(false)
        expect(result.error).toMatch(
          /Access denied|Invalid path|Path outside allowed directory|Unauthorized/
        )
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

        const { POST } = await import('@/app/api/files/parse/route')
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

      const { POST } = await import('@/app/api/files/parse/route')
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

      const { POST } = await import('@/app/api/files/parse/route')
      const response = await POST(request)
      const result = await response.json()

      expect(response.status).toBe(400)
      expect(result.error).toBe('No file path provided')
    })
  })
})
