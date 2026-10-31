/**
 * Tests for file serve API route
 */

import { Readable } from 'node:stream'
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
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'

const {
  mockReadFile,
  mockAuthenticateWorkspaceFile,
  mockStreamAuthorizedWorkspaceFile,
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
    mockStreamAuthorizedWorkspaceFile: vi.fn(),
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

vi.mock('@/lib/uploads/utils/file', () => fileUtilsMock)

vi.mock('@/lib/uploads/utils/file.server', () => fileUtilsServerMock)
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

vi.mock('@/lib/uploads/contexts/workspace/file-manager', () => workspaceFileManagerMock)

vi.mock('@/lib/workspace-files/api', () => ({
  internalWorkspaceFileServeAuth: { authenticate: mockAuthenticateWorkspaceFile },
}))

vi.mock('@/lib/workspace-files/application/stream-authorized-workspace-file', () => ({
  streamAuthorizedWorkspaceFile: mockStreamAuthorizedWorkspaceFile,
}))

vi.mock('@/lib/workspace-files/application/read-workspace-file-record-by-key', () => ({
  readWorkspaceFileRecordByKey: {
    execute: mockReadWorkspaceFileRecordByKey,
    authorize: mockAuthorizeWorkspaceFileRecordByKey,
  },
}))

vi.mock('@/lib/uploads/documents/compile', () => ({
  resolveServableDocBytes: mockResolveServableDocBytes,
}))

vi.mock('@/app/api/files/utils', async (importOriginal) => ({
  createStoredFileStreamResponse: (await importOriginal<typeof import('@/app/api/files/utils')>())
    .createStoredFileStreamResponse,
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

function webStream(text: string): ReadableStream<Uint8Array> {
  return new Blob([text]).stream()
}

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
    mockStreamAuthorizedWorkspaceFile.mockImplementation(async () => webStream('stored bytes'))
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
    mockFileErrorResponse.mockImplementation((error: Error, status = 500) => {
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
      createMockRequest({ url: 'http://localhost:3000/api/files/serve/copilot/doc.pdf' }),
      createRouteContext({ path: ['copilot', 'doc.pdf'] })
    )

    expect(mockDownloadCopilotFile).toHaveBeenCalledWith('copilot/doc.pdf', {
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
        url: 'http://localhost:3000/api/files/serve/workspace/ws/report.pdf',
      }),
      createRouteContext({ path: ['workspace', 'ws', 'report.pdf'] })
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
      createMockRequest({ url: 'http://localhost:3000/api/files/serve/workspace/ws/huge.pdf' }),
      createRouteContext({ path: ['workspace', 'ws', 'huge.pdf'] })
    )

    expect(response.status).toBe(413)
    expect(serveLogger.error).not.toHaveBeenCalled()
  })

  it('answers 499 without an error log when the client disconnects mid-read', async () => {
    const controller = new AbortController()
    mockReadLocalFileWithinLimit.mockImplementation(async () => {
      controller.abort()
      throw new Error('Request aborted')
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/files/serve/workspace/ws/report.pdf', {
        signal: controller.signal,
      }),
      createRouteContext({ path: ['workspace', 'ws', 'report.pdf'] })
    )

    expect(response.status).toBe(499)
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

    async function serveVersionedDoc(
      dependsOnReferencedFiles: boolean,
      method: 'GET' | 'HEAD' = 'GET'
    ) {
      mockResolveStoredFileContext.mockResolvedValue('workspace')
      mockParseWorkspaceFileKey.mockReturnValue('test-workspace-id')
      mockAuthenticateWorkspaceFile.mockResolvedValue(principal)
      fileUtilsServerMockFns.mockDownloadServableFileFromStorage.mockResolvedValue({
        buffer: Buffer.from('compiled'),
        contentType: 'application/pdf',
        ...(dependsOnReferencedFiles ? { dependsOnReferencedFiles: true } : {}),
      })

      const req = createMockRequest({
        method,
        url: 'http://localhost:3000/api/files/serve/workspace/test-workspace-id/report.pdf?v=1756684800000',
      })
      const response = await GET(
        req,
        createRouteContext({ path: ['workspace', 'test-workspace-id', 'report.pdf'] })
      )
      expect(response.status).toBe(200)
      return response
    }

    it('authorizes HEAD without compiling a representation or inventing its length', async () => {
      const response = await serveVersionedDoc(true, 'HEAD')
      expect(await response.text()).toBe('')
      expect(response.headers.get('Content-Length')).toBeNull()
      expect(response.headers.get('Cache-Control')).toBe('private, no-store')
      expect(mockReadWorkspaceFileRecordByKey).toHaveBeenCalled()
      expect(fileUtilsServerMockFns.mockDownloadServableFileFromStorage).not.toHaveBeenCalled()
    })

    it('caches a versioned document immutably when its bytes derive from the stored source alone', async () => {
      const response = await serveVersionedDoc(false)
      expect(response.headers.get('Cache-Control')).toBe('private, max-age=31536000, immutable')
    })

    it('requires revalidation for a versioned document with referenced inputs', async () => {
      const response = await serveVersionedDoc(true)
      expect(response.headers.get('Cache-Control')).toBe('private, no-cache, must-revalidate')
    })
  })

  describe('streaming stored objects', () => {
    const principal = createSessionPrincipal({ userId: 'test-user-id' })
    const video = {
      id: 'file-1',
      workspaceId: 'test-workspace-id',
      name: 'clip.mp4',
      key: 'workspace/test-workspace-id/clip.mp4',
      type: 'application/octet-stream',
      size: 300_000_000,
      updatedAt: new Date('2026-10-31T20:28:58Z'),
      contentUpdatedAt: new Date('2026-10-31T20:28:58Z'),
    }

    function serveWorkspaceFile(
      file: typeof video,
      headers: Record<string, string> = {},
      query = ''
    ) {
      mockResolveStoredFileContext.mockResolvedValue('workspace')
      mockParseWorkspaceFileKey.mockReturnValue('test-workspace-id')
      mockAuthenticateWorkspaceFile.mockResolvedValue(principal)
      mockReadWorkspaceFileRecordByKey.mockResolvedValue({ file })
      const segments = file.key.split('/')
      return GET(
        new NextRequest(`http://localhost:3000/api/files/serve/${file.key}${query}`, { headers }),
        createRouteContext({ path: segments })
      )
    }

    it('streams a file past the transfer ceiling instead of refusing it', async () => {
      const response = await serveWorkspaceFile(video)

      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Length')).toBe(String(video.size))
      expect(response.headers.get('Content-Type')).toBe('video/mp4')
      expect(response.headers.get('Accept-Ranges')).toBe('bytes')
      expect(await response.text()).toBe('stored bytes')
      expect(mockStreamAuthorizedWorkspaceFile).toHaveBeenCalledWith(
        expect.objectContaining({ file: video, principal, range: undefined })
      )
      expect(fileUtilsServerMockFns.mockDownloadServableFileFromStorage).not.toHaveBeenCalled()
    })

    it('rechecks access through the same use case that admitted the file', async () => {
      await serveWorkspaceFile(video)
      const [{ authorize }] = mockStreamAuthorizedWorkspaceFile.mock.calls[0]
      await authorize()
      expect(mockAuthorizeWorkspaceFileRecordByKey).toHaveBeenCalledWith(
        expect.objectContaining({
          principal,
          input: { key: video.key, assertedWorkspaceId: 'test-workspace-id' },
        })
      )
    })

    it('answers a byte range with 206 and reads only that span', async () => {
      const response = await serveWorkspaceFile(video, { Range: 'bytes=100-199' })

      expect(response.status).toBe(206)
      expect(response.headers.get('Content-Range')).toBe(`bytes 100-199/${video.size}`)
      expect(response.headers.get('Content-Length')).toBe('100')
      expect(mockStreamAuthorizedWorkspaceFile).toHaveBeenCalledWith(
        expect.objectContaining({ range: { start: 100, end: 199 } })
      )
    })

    it('refuses a range past the end with 416 without opening storage', async () => {
      const response = await serveWorkspaceFile(video, { Range: `bytes=${video.size}-` })

      expect(response.status).toBe(416)
      expect(response.headers.get('Content-Range')).toBe(`bytes */${video.size}`)
      expect(mockStreamAuthorizedWorkspaceFile).not.toHaveBeenCalled()
    })

    it('answers a revalidation of unchanged bytes with 304 without opening storage', async () => {
      const first = await serveWorkspaceFile(video)
      const etag = first.headers.get('ETag')
      expect(etag).toBeTruthy()
      mockStreamAuthorizedWorkspaceFile.mockClear()

      const response = await serveWorkspaceFile(video, { 'If-None-Match': etag ?? '' })

      expect(response.status).toBe(304)
      expect(mockStreamAuthorizedWorkspaceFile).not.toHaveBeenCalled()
    })

    it('stops matching once a content write moves the file to new bytes', async () => {
      const etag = (await serveWorkspaceFile(video)).headers.get('ETag') ?? ''
      const rewritten = {
        ...video,
        key: 'workspace/test-workspace-id/clip-v2.mp4',
        contentUpdatedAt: new Date('2026-11-01T00:00:00Z'),
      }

      const revalidated = await serveWorkspaceFile(rewritten, { 'If-None-Match': etag })
      const resumed = await serveWorkspaceFile(rewritten, { Range: 'bytes=0-9', 'If-Range': etag })

      expect(revalidated.status).toBe(200)
      expect(resumed.status).toBe(200)
      expect(resumed.headers.get('Content-Length')).toBe(String(video.size))
    })

    it('serves stored bytes under the type their extension names, not the recorded type', async () => {
      const response = await serveWorkspaceFile({
        ...video,
        name: 'export.csv',
        key: 'workspace/test-workspace-id/export.csv',
        type: 'application/vnd.ms-excel',
        size: 3,
      })

      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toBe('text/csv')
    })

    it('streams an uploaded document, which is already the finished file', async () => {
      const response = await serveWorkspaceFile({
        ...video,
        name: 'scan.pdf',
        key: 'workspace/test-workspace-id/scan.pdf',
        type: 'application/pdf',
      })

      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Length')).toBe(String(video.size))
      expect(fileUtilsServerMockFns.mockDownloadServableFileFromStorage).not.toHaveBeenCalled()
    })

    it('streams the raw source of a page rather than rendering it', async () => {
      mockGetContentType.mockReturnValue('text/html')
      const response = await serveWorkspaceFile(
        { ...video, name: 'page.html', key: 'workspace/test-workspace-id/page.html', size: 12 },
        {},
        '?raw=1'
      )

      expect(response.status).toBe(200)
      expect(await response.text()).toBe('stored bytes')
    })

    it.each([
      ['a generated document', { name: 'report.pdf', type: 'text/x-pdflibjs' }, ''],
      ['a page', { name: 'page.html', type: 'text/html' }, ''],
      [
        'a preview, which may be a HEIC transcode',
        { name: 'photo.jpg', type: 'image/jpeg' },
        '?preview=1',
      ],
    ])('keeps %s on the buffered path', async (_label, override, query) => {
      fileUtilsServerMockFns.mockDownloadServableFileFromStorage.mockResolvedValue({
        buffer: Buffer.from('rendered'),
        contentType: 'application/octet-stream',
      })
      await serveWorkspaceFile(
        { ...video, ...override, key: `workspace/test-workspace-id/${override.name}`, size: 8 },
        {},
        query
      )

      expect(mockStreamAuthorizedWorkspaceFile).not.toHaveBeenCalled()
      expect(fileUtilsServerMockFns.mockDownloadServableFileFromStorage).toHaveBeenCalled()
    })

    describe('outside the workspace-file model', () => {
      const key = 'workspace/ws/1790000000000-0123456789abcdef-clip.mp4'

      function serveAttachment(headers: Record<string, string> = {}) {
        mockIsUsingCloudStorage.mockReturnValue(true)
        storageServiceMockFns.mockDownloadFileStream.mockImplementation(async () =>
          Readable.from([Buffer.from('attachment')])
        )
        return GET(
          new NextRequest(`http://localhost:3000/api/files/serve/${key}`, { headers }),
          createRouteContext({ path: key.split('/') })
        )
      }

      it('streams a range of an attachment sized by storage, never buffering it', async () => {
        storageServiceMockFns.mockHeadObject.mockResolvedValue({
          size: 500_000_000,
          version: '"v1"',
        })

        const response = await serveAttachment({ Range: 'bytes=0-1023' })

        expect(response.status).toBe(206)
        expect(response.headers.get('Content-Range')).toBe('bytes 0-1023/500000000')
        expect(response.headers.get('ETag')).toBeTruthy()
        expect(await response.text()).toBe('attachment')
        expect(storageServiceMockFns.mockDownloadFileStream).toHaveBeenCalledWith({
          key,
          context: 'mothership',
          range: { start: 0, end: 1023 },
        })
        expect(storageServiceMockFns.mockDownloadFile).not.toHaveBeenCalled()
      })

      it('still checks access before asking storage anything', async () => {
        mockVerifyFileAccess.mockResolvedValue(false)

        const response = await serveAttachment()

        expect(response.status).toBe(404)
        expect(storageServiceMockFns.mockHeadObject).not.toHaveBeenCalled()
        expect(storageServiceMockFns.mockDownloadFileStream).not.toHaveBeenCalled()
      })

      it('answers 404 for an object storage no longer has', async () => {
        storageServiceMockFns.mockHeadObject.mockResolvedValue(null)

        const response = await serveAttachment()

        expect(response.status).toBe(404)
        expect(storageServiceMockFns.mockDownloadFileStream).not.toHaveBeenCalled()
      })

      it('sends everything when storage offers no version to resume against', async () => {
        storageServiceMockFns.mockHeadObject.mockResolvedValue({ size: 10 })

        const response = await serveAttachment({ Range: 'bytes=0-4', 'If-Range': '"v1"' })

        expect(response.status).toBe(200)
        expect(response.headers.get('ETag')).toBeNull()
        expect(response.headers.get('Content-Length')).toBe('10')
      })
    })
  })
})
