/**
 * Tests for file parse API route
 *
 * @vitest-environment node
 */
import {
  authMockFns,
  createMockRequest,
  hybridAuthMockFns,
  inputValidationMock,
  inputValidationMockFns,
  permissionsMock,
  permissionsMockFns,
  storageServiceMock,
  storageServiceMockFns,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockVerifyFileAccess,
  mockVerifyWorkspaceFileAccess,
  mockGetStorageProvider,
  mockIsUsingCloudStorage,
  mockIsSupportedFileType,
  mockParseFile,
  mockParseBuffer,
  mockFsAccess,
  mockFsStat,
  mockFsReadFile,
  mockFsWriteFile,
  mockJoin,
  actualPath,
  mockUploadWorkspaceFile,
} = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const actualPath = require('path') as typeof import('path')
  return {
    mockVerifyFileAccess: vi.fn().mockResolvedValue(true),
    mockVerifyWorkspaceFileAccess: vi.fn().mockResolvedValue(true),
    mockGetStorageProvider: vi.fn().mockReturnValue('s3'),
    mockIsUsingCloudStorage: vi.fn().mockReturnValue(true),
    mockIsSupportedFileType: vi.fn().mockReturnValue(true),
    mockParseFile: vi.fn().mockResolvedValue({
      content: 'parsed content',
      metadata: { pageCount: 1 },
    }),
    mockParseBuffer: vi.fn().mockResolvedValue({
      content: 'parsed buffer content',
      metadata: { pageCount: 1 },
    }),
    mockFsAccess: vi.fn().mockResolvedValue(undefined),
    mockFsStat: vi.fn().mockImplementation(() => ({ isFile: () => true, size: 17 })),
    mockFsReadFile: vi.fn().mockResolvedValue(Buffer.from('test file content')),
    mockFsWriteFile: vi.fn().mockResolvedValue(undefined),
    mockJoin: vi.fn((...args: string[]): string => {
      if (args[0] === '/test/uploads') {
        return `/test/uploads/${args[args.length - 1]}`
      }
      return actualPath.join(...args)
    }),
    actualPath,
    mockUploadWorkspaceFile: vi
      .fn()
      .mockImplementation(
        async (workspaceId: string, _userId: string, _buffer: Buffer, fileName: string) => ({
          id: 'wf_test',
          name: fileName,
          size: 0,
          type: 'application/octet-stream',
          url: `/api/files/serve/${workspaceId}/${fileName}`,
          key: `${workspaceId}/${fileName}`,
          context: 'workspace',
        })
      ),
  }
})

vi.mock('@/app/api/files/authorization', () => ({
  verifyFileAccess: mockVerifyFileAccess,
  verifyWorkspaceFileAccess: mockVerifyWorkspaceFileAccess,
}))

vi.mock('@/lib/uploads', () => ({
  getStorageProvider: mockGetStorageProvider,
  isUsingCloudStorage: mockIsUsingCloudStorage,
  StorageService: storageServiceMock,
}))

vi.mock('@/lib/file-parsers', () => ({
  isSupportedFileType: mockIsSupportedFileType,
  parseFile: mockParseFile,
  parseBuffer: mockParseBuffer,
}))

vi.mock('@/lib/uploads/core/storage-service', () => storageServiceMock)

vi.mock('path', () => ({
  default: actualPath,
  ...actualPath,
  join: mockJoin,
  basename: actualPath.basename,
  extname: actualPath.extname,
}))

vi.mock('@/lib/uploads/setup.server', () => ({}))
vi.mock('@/lib/uploads/core/setup.server', () => ({
  UPLOAD_DIR_SERVER: '/test/uploads',
}))

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)

vi.mock('@/lib/core/utils/logging', () => ({
  sanitizeUrlForLog: vi.fn((url: string) => url),
}))

vi.mock('@/lib/uploads/contexts/execution', () => ({
  uploadExecutionFile: vi.fn(),
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  uploadWorkspaceFile: mockUploadWorkspaceFile,
}))

vi.mock('@/lib/uploads/server/metadata', () => ({
  getFileMetadataByKey: vi.fn(),
}))

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

vi.mock('fs/promises', () => ({
  default: {
    access: mockFsAccess,
    stat: mockFsStat,
    readFile: mockFsReadFile,
    writeFile: mockFsWriteFile,
  },
  access: mockFsAccess,
  stat: mockFsStat,
  readFile: mockFsReadFile,
  writeFile: mockFsWriteFile,
}))

import { POST } from '@/app/api/files/parse/route'

function setupFileApiMocks(
  options: {
    authenticated?: boolean
    storageProvider?: 's3' | 'blob' | 'local'
    cloudEnabled?: boolean
  } = {}
) {
  const { authenticated = true, storageProvider = 's3', cloudEnabled = true } = options

  if (authenticated) {
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: 'test-user-id', email: 'test@example.com' },
    })
  } else {
    authMockFns.mockGetSession.mockResolvedValue(null)
  }

  hybridAuthMockFns.mockCheckInternalAuth.mockResolvedValue({
    success: authenticated,
    userId: authenticated ? 'test-user-id' : undefined,
    error: authenticated ? undefined : 'Unauthorized',
  })

  hybridAuthMockFns.mockCheckHybridAuth.mockResolvedValue({
    success: authenticated,
    userId: authenticated ? 'test-user-id' : undefined,
    error: authenticated ? undefined : 'Unauthorized',
  })

  hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
    success: authenticated,
    userId: authenticated ? 'test-user-id' : undefined,
    error: authenticated ? undefined : 'Unauthorized',
  })

  mockGetStorageProvider.mockReturnValue(storageProvider)
  mockIsUsingCloudStorage.mockReturnValue(cloudEnabled)
}

describe('File Parse API Route', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    setupFileApiMocks({
      authenticated: true,
    })

    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue({ canView: true })
    storageServiceMockFns.mockHasCloudStorage.mockReturnValue(true)
    storageServiceMockFns.mockDownloadFile.mockResolvedValue(Buffer.from('test file content'))
    mockFsStat.mockResolvedValue({ isFile: () => true, size: 17 })
    mockFsReadFile.mockResolvedValue(Buffer.from('test file content'))
    mockIsSupportedFileType.mockReturnValue(true)
    mockUploadWorkspaceFile.mockClear()
    mockParseFile.mockResolvedValue({
      content: 'parsed content',
      metadata: { pageCount: 1 },
    })
    mockParseBuffer.mockResolvedValue({
      content: 'parsed buffer content',
      metadata: { pageCount: 1 },
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should handle missing file path', async () => {
    const req = createMockRequest('POST', {})

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

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(200)

    if (data.success === true) {
      expect(data).toHaveProperty('output')
    } else {
      expect(data).toHaveProperty('error')
    }
  })

  it('should keep known binary extensions as binary even when the bytes are valid UTF-8', async () => {
    setupFileApiMocks({
      cloudEnabled: true,
      storageProvider: 's3',
      authenticated: true,
    })
    mockIsSupportedFileType.mockReturnValue(false)
    storageServiceMockFns.mockDownloadFile.mockResolvedValue(Buffer.from('valid utf8 bytes'))

    const req = createMockRequest('POST', {
      filePath: '/api/files/serve/execution/workspace-1/workflow-1/execution-1/image.png',
    })

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.output.content).toBe('[Binary PNG file - 16 bytes]')
  })

  it('should parse unknown extensions as text when the bytes look like UTF-8 text', async () => {
    setupFileApiMocks({
      cloudEnabled: true,
      storageProvider: 's3',
      authenticated: true,
    })
    mockIsSupportedFileType.mockReturnValue(false)
    storageServiceMockFns.mockDownloadFile.mockResolvedValue(Buffer.from('plain text content'))

    const req = createMockRequest('POST', {
      filePath: '/api/files/serve/execution/workspace-1/workflow-1/execution-1/readme.customtext',
    })

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.output.content).toBe('plain text content')
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

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toHaveProperty('success')
    expect(data).toHaveProperty('results')
    expect(Array.isArray(data.results)).toBe(true)
    expect(data.results).toHaveLength(2)
  })

  it('should keep the multi-file download cap independent from the remaining parsed-output cap', async () => {
    inputValidationMockFns.mockValidateUrlWithDNS.mockResolvedValue({
      isValid: true,
      resolvedIP: '203.0.113.10',
    })
    inputValidationMockFns.mockSecureFetchWithPinnedIP
      .mockResolvedValueOnce(
        new Response('file content', {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        })
      )
      .mockResolvedValueOnce(
        new Response('second file content', {
          status: 200,
          headers: {
            'content-length': String(20 * 1024 * 1024),
            'content-type': 'text/plain',
          },
        })
      )

    const fourMbContent = 'a'.repeat(4 * 1024 * 1024)
    mockParseBuffer
      .mockResolvedValueOnce({
        content: fourMbContent,
        metadata: { pageCount: 1 },
      })
      .mockResolvedValueOnce({
        content: 'second file',
        metadata: { pageCount: 1 },
      })

    const req = createMockRequest('POST', {
      filePath: ['https://example.com/file1.txt', 'https://example.com/file2.txt'],
    })

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.results).toHaveLength(2)
    expect(inputValidationMockFns.mockSecureFetchWithPinnedIP).toHaveBeenNthCalledWith(
      1,
      'https://example.com/file1.txt',
      '203.0.113.10',
      expect.objectContaining({ maxResponseBytes: 100 * 1024 * 1024 })
    )
    expect(inputValidationMockFns.mockSecureFetchWithPinnedIP).toHaveBeenNthCalledWith(
      2,
      'https://example.com/file2.txt',
      '203.0.113.10',
      expect.objectContaining({ maxResponseBytes: 100 * 1024 * 1024 })
    )
  })

  it('should never dedup external URL fetches by path filename — two URLs sharing image.png both download', async () => {
    inputValidationMockFns.mockValidateUrlWithDNS.mockResolvedValue({
      isValid: true,
      resolvedIP: '203.0.113.10',
    })
    inputValidationMockFns.mockSecureFetchWithPinnedIP
      .mockResolvedValueOnce(
        new Response('first image bytes', {
          status: 200,
          headers: { 'content-type': 'image/png' },
        })
      )
      .mockResolvedValueOnce(
        new Response('second image bytes — different content', {
          status: 200,
          headers: { 'content-type': 'image/png' },
        })
      )
    mockIsSupportedFileType.mockReturnValue(false)
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue('write')

    const req = createMockRequest('POST', {
      filePath: [
        'https://files.slack.com/files-pri/T07-FAAA/download/image.png',
        'https://files.slack.com/files-pri/T07-FBBB/download/image.png',
      ],
      workspaceId: 'workspace-id',
    })

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.results).toHaveLength(2)
    expect(inputValidationMockFns.mockSecureFetchWithPinnedIP).toHaveBeenCalledTimes(2)
    expect(inputValidationMockFns.mockSecureFetchWithPinnedIP).toHaveBeenNthCalledWith(
      1,
      'https://files.slack.com/files-pri/T07-FAAA/download/image.png',
      '203.0.113.10',
      expect.any(Object)
    )
    expect(inputValidationMockFns.mockSecureFetchWithPinnedIP).toHaveBeenNthCalledWith(
      2,
      'https://files.slack.com/files-pri/T07-FBBB/download/image.png',
      '203.0.113.10',
      expect.any(Object)
    )
    expect(mockUploadWorkspaceFile).toHaveBeenCalledTimes(2)
    expect(storageServiceMockFns.mockDownloadFile).not.toHaveBeenCalled()
  })

  it('should stop multi-file parsing once the combined parsed output is too large', async () => {
    inputValidationMockFns.mockValidateUrlWithDNS.mockResolvedValue({
      isValid: true,
      resolvedIP: '203.0.113.10',
    })
    inputValidationMockFns.mockSecureFetchWithPinnedIP.mockResolvedValue(
      new Response('file content', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      })
    )

    mockParseBuffer.mockResolvedValueOnce({
      content: 'a'.repeat(5 * 1024 * 1024 + 1),
      metadata: { pageCount: 1 },
    })

    const req = createMockRequest('POST', {
      filePath: ['https://example.com/file1.txt', 'https://example.com/file2.txt'],
    })

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(413)
    expect(data.success).toBe(false)
    expect(data.error).toContain('too large')
    expect(inputValidationMockFns.mockSecureFetchWithPinnedIP).toHaveBeenCalledTimes(1)
  })

  it('should include successful multi-file parse results when a later file exceeds the cap', async () => {
    inputValidationMockFns.mockValidateUrlWithDNS.mockResolvedValue({
      isValid: true,
      resolvedIP: '203.0.113.10',
    })
    inputValidationMockFns.mockSecureFetchWithPinnedIP.mockResolvedValue(
      new Response('file content', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      })
    )

    mockParseBuffer
      .mockResolvedValueOnce({
        content: 'first file',
        metadata: { pageCount: 1 },
      })
      .mockResolvedValueOnce({
        content: 'a'.repeat(5 * 1024 * 1024),
        metadata: { pageCount: 1 },
      })

    const req = createMockRequest('POST', {
      filePath: ['https://example.com/file1.txt', 'https://example.com/file2.txt'],
    })

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.error).toContain('too large')
    expect(data.results).toHaveLength(1)
    expect(data.results[0].output.content).toBe('first file')
    expect(inputValidationMockFns.mockSecureFetchWithPinnedIP).toHaveBeenCalledTimes(2)
  })

  it('should pass custom headers when fetching external URLs', async () => {
    inputValidationMockFns.mockValidateUrlWithDNS.mockResolvedValue({
      isValid: true,
      resolvedIP: '203.0.113.10',
    })
    inputValidationMockFns.mockSecureFetchWithPinnedIP.mockResolvedValue(
      new Response('private file content', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      })
    )

    const headers = { Authorization: 'Bearer xoxb-test-token' }
    const req = createMockRequest('POST', {
      filePath: 'https://files.slack.com/files-pri/T000-F000/download/report.txt',
      headers,
    })

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(inputValidationMockFns.mockSecureFetchWithPinnedIP).toHaveBeenCalledWith(
      'https://files.slack.com/files-pri/T000-F000/download/report.txt',
      '203.0.113.10',
      expect.objectContaining({
        timeout: 30000,
        headers,
      })
    )
  })

  it('should reject oversized external downloads before reading the body', async () => {
    inputValidationMockFns.mockValidateUrlWithDNS.mockResolvedValue({
      isValid: true,
      resolvedIP: '203.0.113.10',
    })
    inputValidationMockFns.mockSecureFetchWithPinnedIP.mockResolvedValue(
      new Response('oversized', {
        status: 200,
        headers: { 'content-length': '104857601', 'content-type': 'text/plain' },
      })
    )

    const req = createMockRequest('POST', {
      filePath: 'https://example.com/large.txt',
    })

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(false)
    expect(data.error).toContain('too large')
    expect(inputValidationMockFns.mockSecureFetchWithPinnedIP).toHaveBeenCalledWith(
      'https://example.com/large.txt',
      '203.0.113.10',
      expect.objectContaining({
        maxResponseBytes: 104857600,
      })
    )
  })

  it('should reject oversized local files before materializing them', async () => {
    setupFileApiMocks({
      cloudEnabled: false,
      storageProvider: 'local',
      authenticated: true,
    })
    mockFsStat.mockResolvedValue({ isFile: () => true, size: 104857601 })

    const req = createMockRequest('POST', {
      filePath: 'workspace/large.txt',
    })

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(false)
    expect(data.error).toContain('too large')
    expect(mockFsReadFile).not.toHaveBeenCalled()
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

    storageServiceMockFns.mockDownloadFile.mockRejectedValue(new Error('Access denied'))
    storageServiceMockFns.mockHasCloudStorage.mockReturnValue(true)

    const req = new NextRequest('http://localhost:3000/api/files/parse', {
      method: 'POST',
      body: JSON.stringify({
        filePath: '/api/files/serve/s3/test-file.txt',
      }),
    })

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

    mockFsAccess.mockRejectedValue(new Error('ENOENT: no such file'))

    const req = createMockRequest('POST', {
      filePath: 'nonexistent.txt',
    })

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
    setupFileApiMocks({
      authenticated: true,
    })
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue({ canView: true })
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

        const response = await POST(request)
        const result = await response.json()

        if (result.error) {
          expect(result.error).not.toMatch(
            /Access denied|Path outside allowed directory|Invalid path/
          )
        }
      }
    })

    it('should not treat .. inside external URLs as path traversal', async () => {
      inputValidationMockFns.mockValidateUrlWithDNS.mockResolvedValue({
        isValid: true,
        resolvedIP: '203.0.113.10',
      })
      inputValidationMockFns.mockSecureFetchWithPinnedIP.mockResolvedValue(
        new Response('slack file content', {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        })
      )
      permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue('write')

      // Slack truncates long titles with a literal ellipsis, so the slug contains `..`
      const slackUrl =
        'https://files.slack.com/files-pri/T08-F0B/_other__no_invitation_messages_get_sent_-_sim_on_railway...txt'

      const request = new NextRequest('http://localhost:3000/api/files/parse', {
        method: 'POST',
        body: JSON.stringify({ filePath: slackUrl, workspaceId: 'workspace-id' }),
      })

      const response = await POST(request)
      const result = await response.json()

      expect(result.success).toBe(true)
      // The URL reaching the pinned fetch proves it passed validation and routed
      // to external-URL handling rather than being rejected as a local path.
      expect(inputValidationMockFns.mockSecureFetchWithPinnedIP).toHaveBeenCalledWith(
        slackUrl,
        '203.0.113.10',
        expect.any(Object)
      )
    })

    it('should still reject traversal in https URLs that look like internal serve URLs', async () => {
      inputValidationMockFns.mockValidateUrlWithDNS.mockResolvedValue({
        isValid: true,
        resolvedIP: '203.0.113.10',
      })
      inputValidationMockFns.mockSecureFetchWithPinnedIP.mockResolvedValue(
        new Response('should never be fetched', { status: 200 })
      )

      // Absolute https URL containing `/api/files/serve/` matches isInternalFileUrl and would
      // route to handleCloudFile — so it must keep traversal protection, not be waved through
      // as an external URL.
      const request = new NextRequest('http://localhost:3000/api/files/parse', {
        method: 'POST',
        body: JSON.stringify({
          filePath: 'https://attacker.com/api/files/serve/../../../etc/passwd',
        }),
      })

      const response = await POST(request)
      const result = await response.json()

      expect(result.success).toBe(false)
      expect(result.error).toMatch(/Access denied: path traversal detected/)
      expect(inputValidationMockFns.mockSecureFetchWithPinnedIP).not.toHaveBeenCalled()
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
