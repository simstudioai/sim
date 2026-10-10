/**
 * Tests for file serve API route
 */

import {
  authMockFns,
  hybridAuthMockFns,
  storageServiceMock,
  storageServiceMockFns,
} from '@sim/testing'
import {
  createExecutorPrincipal,
  createSessionPrincipal,
} from '@sim/testing/factories/principal.factory'
import { createRouteContext } from '@sim/testing/helpers/http'
import { fileReadReceiptMock } from '@sim/testing/mocks/file-read-receipt.mock'
import { fileUtilsMock, fileUtilsMockFns } from '@sim/testing/mocks/file-utils.mock'
import {
  fileUtilsServerMock,
  fileUtilsServerMockFns,
} from '@sim/testing/mocks/file-utils-server.mock'
import {
  filesAuthorizationMock,
  filesAuthorizationMockFns,
} from '@sim/testing/mocks/files-authorization.mock'
import { getMockLogger } from '@sim/testing/mocks/logger.mock'
import { createMockRequest } from '@sim/testing/mocks/request.mock'
import { uploadsMock, uploadsMockFns } from '@sim/testing/mocks/uploads.mock'
import {
  uploadsMetadataMock,
  uploadsMetadataMockFns,
} from '@sim/testing/mocks/uploads-metadata.mock'
import {
  workspaceFileManagerMock,
  workspaceFileManagerMockFns,
} from '@sim/testing/mocks/workspace-file-manager.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'

const {
  mockReadFile,
  mockAuthenticateWorkspaceFile,
  mockReadWorkspaceFileContentByKey,
  mockReadWorkspaceFileRecordByKey,
  mockAuthorizeWorkspaceFileRecordByKey,
  mockResolveServableDocBytes,
  mockGetContentType,
  mockFindLocalFile,
  mockReadLocalFileWithinLimit,
  mockCreateFileResponse,
  mockCreateConditionalFileResponse,
  mockFileErrorResponse,
  FileNotFoundError,
  mockReadOrganizationAssistantImage,
} = vi.hoisted(() => {
  class FileNotFoundErrorClass extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'FileNotFoundError'
    }
  }
  return {
    mockReadOrganizationAssistantImage: vi.fn(),
    mockReadFile: vi.fn(),
    mockAuthenticateWorkspaceFile: vi.fn(),
    mockReadWorkspaceFileContentByKey: vi.fn(),
    mockReadWorkspaceFileRecordByKey: vi.fn(),
    mockAuthorizeWorkspaceFileRecordByKey: vi.fn(async () => undefined),
    mockResolveServableDocBytes: vi.fn(),
    mockGetContentType: vi.fn(),
    mockFindLocalFile: vi.fn(),
    mockReadLocalFileWithinLimit: vi.fn(),
    mockCreateFileResponse: vi.fn(),
    mockCreateConditionalFileResponse: vi.fn(),
    mockFileErrorResponse: vi.fn(),
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

vi.mock('@/app/api/files/authorization', () => filesAuthorizationMock)

vi.mock('@/lib/uploads', () => uploadsMock)

vi.mock('@/lib/uploads/core/storage-service', () => storageServiceMock)

vi.mock('@/lib/uploads/utils/file-utils', () => fileUtilsMock)

vi.mock('@/lib/uploads/utils/file-utils.server', () => fileUtilsServerMock)
vi.mock('@/lib/workspace-files/read-receipt', () => fileReadReceiptMock)

vi.mock('@/lib/uploads/server/metadata', () => uploadsMetadataMock)

vi.mock('@/lib/uploads/setup.server', () => ({}))

vi.mock('@/lib/execution/sandbox/run-task', () => ({
  runSandboxTask: vi
    .fn()
    .mockImplementation(async (taskId: string) =>
      taskId === 'pdf-generate' ? Buffer.from('%PDF-compiled') : Buffer.from('PK\x03\x04compiled')
    ),
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => workspaceFileManagerMock)

vi.mock('@/lib/workspace-files/api', () => ({
  internalWorkspaceFileServeAuth: { authenticate: mockAuthenticateWorkspaceFile },
}))

vi.mock('@/lib/workspace-files/application/read-workspace-file-content-by-key', () => ({
  readWorkspaceFileContentByKey: { execute: mockReadWorkspaceFileContentByKey },
  readWorkspaceFileRecordByKey: {
    execute: mockReadWorkspaceFileRecordByKey,
    authorize: mockAuthorizeWorkspaceFileRecordByKey,
  },
}))

vi.mock('@/lib/uploads/documents/compile', () => ({
  resolveServableDocBytes: mockResolveServableDocBytes,
}))

vi.mock('@/app/api/files/utils', () => ({
  FileNotFoundError,
  createFileResponse: mockCreateFileResponse,
  createConditionalFileResponse: mockCreateConditionalFileResponse,
  createFileErrorResponse: mockFileErrorResponse,
  getContentType: mockGetContentType,
  extractStorageKey: vi.fn().mockImplementation((path: string) => path.split('/').pop()),
  extractFilename: vi.fn().mockImplementation((path: string) => path.split('/').pop()),
  findLocalFile: mockFindLocalFile,
  readLocalFileWithinLimit: mockReadLocalFileWithinLimit,
}))

import { GET } from '@/app/api/files/serve/[...path]/route'

const mockResolveStoredFileContext = uploadsMetadataMockFns.mockResolveStoredFileContext
const mockVerifyFileAccess = filesAuthorizationMockFns.mockVerifyFileAccess
const mockInferContextFromKey = fileUtilsMockFns.mockInferContextFromKey
const mockParseWorkspaceFileKey = workspaceFileManagerMockFns.mockParseWorkspaceFileKey
const serveLogger = getMockLogger('FilesServeAPI')
const mockDownloadCopilotFile = uploadsMockFns.mockDownloadCopilotFile
const mockIsUsingCloudStorage = uploadsMockFns.mockIsUsingCloudStorage

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
    mockAuthenticateWorkspaceFile.mockResolvedValue(
      createSessionPrincipal({ userId: 'test-user-id' })
    )
    mockReadWorkspaceFileContentByKey.mockResolvedValue({
      file: {
        id: 'file-1',
        workspaceId: 'test-workspace-id',
        name: 'report.pdf',
      },
      content: Buffer.from('generated source'),
    })
    mockReadWorkspaceFileRecordByKey.mockResolvedValue({
      file: {
        id: 'file-1',
        workspaceId: 'test-workspace-id',
        name: 'report.pdf',
        key: 'workspace/test-workspace-id/report.pdf',
        type: 'text/x-pdflibjs',
        size: 16,
        contentUpdatedAt: new Date('2026-09-06'),
      },
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
      (file: { buffer: Buffer; contentType: string; filename: string; cacheControl?: string }) => {
        return new Response(file.buffer, {
          status: 200,
          headers: {
            'Content-Type': file.contentType,
            ...(file.cacheControl ? { 'Cache-Control': file.cacheControl } : {}),
            'Content-Disposition': `inline; filename="${file.filename}"`,
          },
        })
      }
    )
    mockCreateConditionalFileResponse.mockImplementation((file: unknown) =>
      mockCreateFileResponse(file)
    )
    mockFileErrorResponse.mockImplementation((error: Error) => {
      return new Response(JSON.stringify({ error: error.name, message: error.message }), {
        status: error.name === 'FileNotFoundError' ? 404 : status,
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
      createMockRequest({
        url: 'http://localhost/api/files/serve/execution%2Fworkspace%2Fworkflow%2Frun%2Fimage.png?context=execution',
      }),
      createRouteContext({ path: ['execution/workspace/workflow/run/image.png'] })
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

    await GET(
      createMockRequest({ url: 'http://localhost:3000/api/files/serve/copilot/doc.txt' }),
      createRouteContext({ path: ['copilot', 'doc.txt'] })
    )

    expect(mockDownloadCopilotFile).toHaveBeenCalledWith('copilot/doc.txt', {
      maxBytes: MAX_BUFFERED_TRANSFER_BYTES,
    })
  })

  it.each(['', 's3/', 'blob/'])(
    'denies private chat images through generic %s serving',
    async (prefix) => {
      const key = `${prefix}chat-images/chat/request/image.webp`
      const response = await GET(
        createMockRequest({
          url: `http://localhost/api/files/serve/${key}?context=profile-pictures`,
        }),
        createRouteContext({ path: key.split('/') })
      )
      expect(response.status).toBe(404)
      expect(mockReadOrganizationAssistantImage).not.toHaveBeenCalled()
      expect(mockCreateFileResponse).not.toHaveBeenCalled()
    }
  )

  it('requires a real session for private Assistant images even when legacy auth succeeds', async () => {
    authMockFns.mockGetSession.mockResolvedValue(null)
    const key = 'assistant/org-1/user-1/upload-1/image.png'
    const response = await GET(
      createMockRequest({ url: `http://localhost/api/files/serve/${key}` }),
      createRouteContext({ path: key.split('/') })
    )
    expect(response.status).toBe(401)
    expect(mockReadOrganizationAssistantImage).not.toHaveBeenCalled()
  })

  it('bounds the local read rather than trusting the stored size', async () => {
    await GET(
      createMockRequest({
        url: 'http://localhost:3000/api/files/serve/workspace/ws/test-file.txt',
      }),
      createRouteContext({ path: ['workspace', 'ws', 'test-file.txt'] })
    )

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
    // The real createFileErrorResponse owns the status mapping; mirror it here so the
    // route's own error path is what decides, not the mock's default 500.
    mockFileErrorResponse.mockImplementation(
      (error: Error, status = 500) =>
        new Response(JSON.stringify({ error: error.name }), {
          status: error.name === 'PayloadSizeLimitError' ? 413 : status,
        })
    )

    const response = await GET(
      createMockRequest({ url: 'http://localhost:3000/api/files/serve/workspace/ws/huge.bin' }),
      createRouteContext({ path: ['workspace', 'ws', 'huge.bin'] })
    )

    expect(response.status).toBe(413)
    expect(serveLogger.error).not.toHaveBeenCalled()
  })

  describe('versioned cache lifetime', () => {
    const principal = createExecutorPrincipal({
      subjectUserId: 'test-user-id',
      workspaceId: 'test-workspace-id',
      audience: 'sim:workspace-files',
      issuedAt: new Date('2026-08-01T00:00:00Z'),
      expiresAt: new Date('2026-08-01T01:00:00Z'),
      delegationContext: {
        kind: 'workflow_execution',
        workflowId: 'workflow-1',
      },
    })

    async function serveVersionedDoc(dependsOnReferencedFiles: boolean) {
      mockResolveStoredFileContext.mockResolvedValue('workspace')
      mockParseWorkspaceFileKey.mockReturnValue('test-workspace-id')
      mockAuthenticateWorkspaceFile.mockResolvedValue(principal)
      fileUtilsServerMockFns.mockDownloadServableFileFromStorage.mockResolvedValue({
        buffer: Buffer.from('compiled'),
        contentType: 'application/pdf',
        ...(dependsOnReferencedFiles ? { dependsOnReferencedFiles: true } : {}),
      })

      const req = createMockRequest({
        url: 'http://localhost:3000/api/files/serve/workspace/test-workspace-id/report.pdf?v=1756684800000',
      })
      const response = await GET(
        req,
        createRouteContext({ path: ['workspace', 'test-workspace-id', 'report.pdf'] })
      )
      expect(response.status).toBe(200)
      return response
    }

    it('caches a versioned document immutably when its bytes derive from the stored source alone', async () => {
      const response = await serveVersionedDoc(false)
      expect(response.headers.get('Cache-Control')).toBe('private, max-age=31536000, immutable')
    })

    it('requires revalidation for a versioned document with referenced inputs', async () => {
      const response = await serveVersionedDoc(true)
      expect(response.headers.get('Cache-Control')).toBe('private, no-cache, must-revalidate')
    })
  })
})
