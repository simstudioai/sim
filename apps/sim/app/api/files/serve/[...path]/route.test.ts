/**
 * Tests for file serve API route
 *
 * @vitest-environment node
 */
import { hybridAuthMockFns, storageServiceMock, storageServiceMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'

vi.mock('@sim/logger', () => ({
  createLogger: vi.fn(() => serveLogger),
  logger: serveLogger,
  runWithRequestContext: vi.fn(<T>(_ctx: unknown, fn: () => T): T => fn()),
  getRequestContext: vi.fn(() => undefined),
}))

const {
  mockVerifyFileAccess,
  mockReadFile,
  mockIsUsingCloudStorage,
  mockDownloadCopilotFile,
  mockInferContextFromKey,
  mockResolveStoredFileContext,
  mockParseWorkspaceFileKey,
  mockAuthenticateWorkspaceFile,
  mockReadWorkspaceFileContentByKey,
  mockResolveServableDocBytes,
  mockGetContentType,
  mockFindLocalFile,
  mockReadLocalFileWithinLimit,
  mockCreateFileResponse,
  mockCreateErrorResponse,
  FileNotFoundError,
  serveLogger,
} = vi.hoisted(() => {
  class FileNotFoundErrorClass extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'FileNotFoundError'
    }
  }
  return {
    serveLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    mockVerifyFileAccess: vi.fn(),
    mockReadFile: vi.fn(),
    mockIsUsingCloudStorage: vi.fn(),
    mockDownloadCopilotFile: vi.fn(),
    mockInferContextFromKey: vi.fn(),
    mockResolveStoredFileContext: vi.fn(),
    mockParseWorkspaceFileKey: vi.fn(),
    mockAuthenticateWorkspaceFile: vi.fn(),
    mockReadWorkspaceFileContentByKey: vi.fn(),
    mockResolveServableDocBytes: vi.fn(),
    mockGetContentType: vi.fn(),
    mockFindLocalFile: vi.fn(),
    mockReadLocalFileWithinLimit: vi.fn(),
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

vi.mock('@/app/api/files/authorization', () => ({
  verifyFileAccess: mockVerifyFileAccess,
}))

vi.mock('@/lib/uploads', () => ({
  CopilotFiles: {
    downloadCopilotFile: mockDownloadCopilotFile,
  },
  isUsingCloudStorage: mockIsUsingCloudStorage,
}))

vi.mock('@/lib/uploads/core/storage-service', () => storageServiceMock)

vi.mock('@/lib/uploads/utils/file-utils', () => ({
  inferContextFromKey: mockInferContextFromKey,
}))

vi.mock('@/lib/uploads/server/metadata', () => ({
  resolveStoredFileContext: mockResolveStoredFileContext,
}))

vi.mock('@/lib/uploads/setup.server', () => ({}))

vi.mock('@/lib/execution/sandbox/run-task', () => ({
  runSandboxTask: vi
    .fn()
    .mockImplementation(async (taskId: string) =>
      taskId === 'pdf-generate' ? Buffer.from('%PDF-compiled') : Buffer.from('PK\x03\x04compiled')
    ),
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  parseWorkspaceFileKey: mockParseWorkspaceFileKey,
}))

vi.mock('@/lib/workspace-files/api', () => ({
  internalWorkspaceFileServeAuth: { authenticate: mockAuthenticateWorkspaceFile },
}))

vi.mock('@/lib/workspace-files/application/read-workspace-file-content-by-key', () => ({
  readWorkspaceFileContentByKey: { execute: mockReadWorkspaceFileContentByKey },
}))

vi.mock('@/lib/copilot/tools/server/files/doc-compile', () => ({
  resolveServableDocBytes: mockResolveServableDocBytes,
}))

vi.mock('@/app/api/files/utils', () => ({
  FileNotFoundError,
  createFileResponse: mockCreateFileResponse,
  createErrorResponse: mockCreateErrorResponse,
  getContentType: mockGetContentType,
  extractStorageKey: vi.fn().mockImplementation((path: string) => path.split('/').pop()),
  extractFilename: vi.fn().mockImplementation((path: string) => path.split('/').pop()),
  findLocalFile: mockFindLocalFile,
  readLocalFileWithinLimit: mockReadLocalFileWithinLimit,
}))

import { GET } from '@/app/api/files/serve/[...path]/route'

describe('File Serve API Route', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'test-user-id',
    })
    mockVerifyFileAccess.mockResolvedValue(true)
    mockReadFile.mockResolvedValue(Buffer.from('test content'))
    mockIsUsingCloudStorage.mockReturnValue(false)
    storageServiceMockFns.mockHasCloudStorage.mockReturnValue(true)
    // A `workspace/…` key is what both a workspace file and a mothership chat
    // attachment carry; only the stored binding tells them apart, so the default
    // here is the attachment and the workspace cases opt in explicitly.
    mockInferContextFromKey.mockReturnValue('workspace')
    mockResolveStoredFileContext.mockResolvedValue('mothership')
    mockParseWorkspaceFileKey.mockReturnValue(undefined)
    mockAuthenticateWorkspaceFile.mockResolvedValue({
      kind: 'session',
      userId: 'test-user-id',
      sessionId: 'session-1',
    })
    mockReadWorkspaceFileContentByKey.mockResolvedValue({
      file: {
        id: 'file-1',
        workspaceId: 'test-workspace-id',
        name: 'report.pdf',
      },
      content: Buffer.from('generated source'),
    })
    mockResolveServableDocBytes.mockImplementation(
      async ({ rawBuffer, fileName }: { rawBuffer: Buffer; fileName: string }) => ({
        buffer: rawBuffer,
        contentType: mockGetContentType(fileName),
      })
    )
    mockGetContentType.mockReturnValue('text/plain')
    mockFindLocalFile.mockReturnValue('/test/uploads/test-file.txt')
    mockReadLocalFileWithinLimit.mockImplementation(async (filePath: string) =>
      mockReadFile(filePath)
    )
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

  it('bounds every buffered read at the shared transfer ceiling', async () => {
    mockIsUsingCloudStorage.mockReturnValue(true)
    mockResolveStoredFileContext.mockResolvedValue('copilot')
    mockInferContextFromKey.mockReturnValue('copilot')
    mockDownloadCopilotFile.mockResolvedValue(Buffer.from('bytes'))

    await GET(new NextRequest('http://localhost:3000/api/files/serve/copilot/doc.txt'), {
      params: Promise.resolve({ path: ['copilot', 'doc.txt'] }),
    })

    expect(mockDownloadCopilotFile).toHaveBeenCalledWith('copilot/doc.txt', {
      maxBytes: MAX_BUFFERED_TRANSFER_BYTES,
    })
  })

  it('bounds the local read rather than trusting the stored size', async () => {
    await GET(new NextRequest('http://localhost:3000/api/files/serve/workspace/ws/test-file.txt'), {
      params: Promise.resolve({ path: ['workspace', 'ws', 'test-file.txt'] }),
    })

    expect(mockReadLocalFileWithinLimit).toHaveBeenCalledWith(
      '/test/uploads/test-file.txt',
      MAX_BUFFERED_TRANSFER_BYTES,
      expect.any(String)
    )
  })

  it('answers 413 rather than 500 when a file is too large to serve resident', async () => {
    const { PayloadSizeLimitError } = await import('@/lib/core/utils/stream-limits')
    mockReadLocalFileWithinLimit.mockRejectedValue(
      new PayloadSizeLimitError({
        label: 'served file',
        maxBytes: MAX_BUFFERED_TRANSFER_BYTES,
        observedBytes: MAX_BUFFERED_TRANSFER_BYTES + 1,
      })
    )
    // The real createErrorResponse owns the status mapping; mirror it here so the
    // route's own error path is what decides, not the mock's default 500.
    mockCreateErrorResponse.mockImplementation(
      (error: Error) =>
        new Response(JSON.stringify({ error: error.name }), {
          status: error.name === 'PayloadSizeLimitError' ? 413 : 500,
        })
    )

    const response = await GET(
      new NextRequest('http://localhost:3000/api/files/serve/workspace/ws/huge.bin'),
      { params: Promise.resolve({ path: ['workspace', 'ws', 'huge.bin'] }) }
    )

    expect(response.status).toBe(413)
    expect(serveLogger.error).not.toHaveBeenCalled()
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
    storageServiceMockFns.mockDownloadFile.mockResolvedValue(Buffer.from('test cloud file content'))
    mockGetContentType.mockReturnValue('image/png')

    const req = new NextRequest(
      'http://localhost:3000/api/files/serve/workspace/test-workspace-id/1234567890-image.png'
    )
    const params = { path: ['workspace', 'test-workspace-id', '1234567890-image.png'] }

    const response = await GET(req, { params: Promise.resolve(params) })

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('image/png')

    expect(storageServiceMockFns.mockDownloadFile).toHaveBeenCalledWith({
      key: 'workspace/test-workspace-id/1234567890-image.png',
      context: 'mothership',
      maxBytes: MAX_BUFFERED_TRANSFER_BYTES,
    })
  })

  it('serves a workspace document through the authorized use case and preserves the Principal', async () => {
    const principal = {
      kind: 'delegated' as const,
      serviceId: 'executor' as const,
      subjectUserId: 'test-user-id',
      workspaceId: 'test-workspace-id',
      delegationId: 'delegation-1',
      audience: 'sim:workspace-files',
      issuedAt: new Date('2026-08-01T00:00:00Z'),
      expiresAt: new Date('2026-08-01T01:00:00Z'),
      delegationContext: {
        kind: 'workflow_execution' as const,
        workflowId: 'workflow-1',
      },
    }
    mockResolveStoredFileContext.mockResolvedValue('workspace')
    mockParseWorkspaceFileKey.mockReturnValue('test-workspace-id')
    mockAuthenticateWorkspaceFile.mockResolvedValue(principal)
    mockResolveServableDocBytes.mockResolvedValue({
      buffer: Buffer.from('%PDF-compiled'),
      contentType: 'application/pdf',
    })

    const req = new NextRequest(
      'http://localhost:3000/api/files/serve/workspace/test-workspace-id/report.pdf'
    )
    const response = await GET(req, {
      params: Promise.resolve({
        path: ['workspace', 'test-workspace-id', 'report.pdf'],
      }),
    })

    expect(response.status).toBe(200)
    expect(mockReadWorkspaceFileContentByKey).toHaveBeenCalledWith({
      principal,
      input: {
        key: 'workspace/test-workspace-id/report.pdf',
        assertedWorkspaceId: 'test-workspace-id',
      },
      request: req,
    })
    expect(mockResolveServableDocBytes).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'test-workspace-id',
        filePrincipal: principal,
      })
    )
    expect(hybridAuthMockFns.mockCheckSessionOrInternalAuth).not.toHaveBeenCalled()
    expect(mockVerifyFileAccess).not.toHaveBeenCalled()
  })

  it('serves a mothership chat attachment stored under a workspace key', async () => {
    /**
     * The attachment shares the `workspace/…` prefix but is recorded as
     * `context = 'mothership'`, so the workspace-file use case — which matches on
     * `context = 'workspace'` — would answer 404 for a file that is right there.
     */
    mockIsUsingCloudStorage.mockReturnValue(true)
    storageServiceMockFns.mockDownloadFile.mockResolvedValue(Buffer.from('attachment bytes'))
    mockGetContentType.mockReturnValue('image/png')

    const req = new NextRequest(
      'http://localhost:3000/api/files/serve/workspace/test-workspace-id/1234567890-photo.png?preview=1'
    )
    const response = await GET(req, {
      params: Promise.resolve({
        path: ['workspace', 'test-workspace-id', '1234567890-photo.png'],
      }),
    })

    expect(response.status).toBe(200)
    expect(mockReadWorkspaceFileContentByKey).not.toHaveBeenCalled()
    expect(mockAuthenticateWorkspaceFile).not.toHaveBeenCalled()
    expect(mockVerifyFileAccess).toHaveBeenCalledWith(
      'workspace/test-workspace-id/1234567890-photo.png',
      'test-user-id',
      undefined,
      'mothership',
      false
    )
    expect(storageServiceMockFns.mockDownloadFile).toHaveBeenCalledWith({
      key: 'workspace/test-workspace-id/1234567890-photo.png',
      context: 'mothership',
      maxBytes: MAX_BUFFERED_TRANSFER_BYTES,
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

  describe('failure log level', () => {
    it('records a missing file at info, not error', async () => {
      /** A superseded key is an ordinary 404, not a server fault. */
      const req = new NextRequest('http://localhost:3000/api/files/serve/')
      const response = await GET(req, { params: Promise.resolve({ path: [] }) })

      expect(response.status).toBe(404)
      expect(serveLogger.info).toHaveBeenCalledWith(
        'Error serving file:',
        expect.objectContaining({ reason: expect.any(String) })
      )
      expect(serveLogger.error).not.toHaveBeenCalled()
    })

    it('still records a genuine failure at error', async () => {
      mockVerifyFileAccess.mockRejectedValueOnce(new Error('permission backend down'))

      const req = new NextRequest(
        'http://localhost:3000/api/files/serve/workspace/ws/test-file.txt'
      )
      await GET(req, {
        params: Promise.resolve({ path: ['workspace', 'ws', 'test-file.txt'] }),
      }).catch(() => undefined)

      expect(serveLogger.error).toHaveBeenCalled()
    })
  })
})
