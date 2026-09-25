/**
 * Tests for file serve API route
 */
import {
  authMockFns,
  hybridAuthMockFns,
  storageServiceMock,
  storageServiceMockFns,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'

vi.mock('@sim/logger', () => ({
  createLogger: vi.fn(() => serveLogger),
  logger: serveLogger,
  runWithRequestContext: vi.fn(<T>(_ctx: unknown, fn: () => T): T => fn()),
  getRequestContext: vi.fn(() => undefined),
  setRequestAuth: vi.fn(),
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
  mockCreateConditionalFileResponse,
  mockCreateErrorResponse,
  FileNotFoundError,
  serveLogger,
  mockReadOrganizationAssistantImage,
} = vi.hoisted(() => {
  class FileNotFoundErrorClass extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'FileNotFoundError'
    }
  }
  return {
    serveLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    mockReadOrganizationAssistantImage: vi.fn(),
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
    mockCreateConditionalFileResponse: vi.fn(),
    mockCreateErrorResponse: vi.fn(),
    FileNotFoundError: FileNotFoundErrorClass,
  }
})

vi.mock('@/lib/uploads/contexts/organization-assistant/application', () => ({
  readOrganizationChatAttachment: mockReadOrganizationAssistantImage,
}))

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

vi.mock('@/lib/mothership/tools/server/files/doc-compile', () => ({
  resolveServableDocBytes: mockResolveServableDocBytes,
}))

vi.mock('@/app/api/files/utils', () => ({
  FileNotFoundError,
  createFileResponse: mockCreateFileResponse,
  createConditionalFileResponse: mockCreateConditionalFileResponse,
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
    // Delegates so the existing assertions on the response payload — including its
    // Cache-Control — read the same call list whichever helper the route reached for.
    mockCreateConditionalFileResponse.mockImplementation((file: unknown) =>
      mockCreateFileResponse(file)
    )
    mockCreateErrorResponse.mockImplementation((error: Error) => {
      return new Response(JSON.stringify({ error: error.name, message: error.message }), {
        status: error.name === 'FileNotFoundError' ? 404 : 500,
        headers: { 'Content-Type': 'application/json' },
      })
    })
  })

  it('requires authentication for execution downloads before reading bytes', async () => {
    mockResolveStoredFileContext.mockResolvedValue('execution')
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: false,
      error: 'Unauthorized',
    })
    const response = await GET(
      new NextRequest(
        'http://localhost/api/files/serve/execution%2Fworkspace%2Fworkflow%2Frun%2Fimage.png?context=execution'
      ),
      {
        params: Promise.resolve({ path: ['execution/workspace/workflow/run/image.png'] }),
      }
    )
    expect(response.status).toBe(401)
    expect(mockVerifyFileAccess).not.toHaveBeenCalled()
    expect(mockReadFile).not.toHaveBeenCalled()
    expect(storageServiceMockFns.mockDownloadFile).not.toHaveBeenCalled()
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

  it.each(['', 's3/', 'blob/'])(
    'denies private chat images through generic %s serving',
    async (prefix) => {
      const key = `${prefix}chat-images/chat/request/image.webp`
      const response = await GET(
        new NextRequest(`http://localhost/api/files/serve/${key}?context=profile-pictures`),
        { params: Promise.resolve({ path: key.split('/') }) }
      )
      expect(response.status).toBe(404)
      expect(mockReadOrganizationAssistantImage).not.toHaveBeenCalled()
      expect(mockCreateFileResponse).not.toHaveBeenCalled()
    }
  )

  it('requires a real session for private Assistant images even when legacy auth succeeds', async () => {
    authMockFns.mockGetSession.mockResolvedValue(null)
    const key = 'assistant/org-1/user-1/upload-1/image.png'
    const response = await GET(new NextRequest(`http://localhost/api/files/serve/${key}`), {
      params: Promise.resolve({ path: key.split('/') }),
    })
    expect(response.status).toBe(401)
    expect(mockReadOrganizationAssistantImage).not.toHaveBeenCalled()
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

  describe('versioned cache lifetime', () => {
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

    async function serveVersionedDoc(dependsOnReferencedFiles: boolean) {
      mockResolveStoredFileContext.mockResolvedValue('workspace')
      mockParseWorkspaceFileKey.mockReturnValue('test-workspace-id')
      mockAuthenticateWorkspaceFile.mockResolvedValue(principal)
      mockResolveServableDocBytes.mockResolvedValue({
        buffer: Buffer.from('compiled'),
        contentType: 'application/pdf',
        ...(dependsOnReferencedFiles ? { dependsOnReferencedFiles: true } : {}),
      })

      const req = new NextRequest(
        'http://localhost:3000/api/files/serve/workspace/test-workspace-id/report.pdf?v=1756684800000'
      )
      await GET(req, {
        params: Promise.resolve({ path: ['workspace', 'test-workspace-id', 'report.pdf'] }),
      })
      return mockCreateFileResponse.mock.calls.at(-1)?.[0]
    }

    it('caches a versioned document immutably when its bytes derive from the stored source alone', async () => {
      expect(await serveVersionedDoc(false)).toEqual(
        expect.objectContaining({ cacheControl: 'private, max-age=31536000, immutable' })
      )
    })

    it('attaches a validator to a revalidated response so the next check can be answered 304', async () => {
      await serveVersionedDoc(true)
      expect(mockCreateConditionalFileResponse).toHaveBeenCalled()
    })
  })
})
