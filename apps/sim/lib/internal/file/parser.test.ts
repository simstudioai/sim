/**
 * Tests for the direct file parser operation.
 */

import { Readable } from 'node:stream'
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
import { fileParsersMock, fileParsersMockFns } from '@sim/testing/mocks/file-parsers.mock'
import { uploadsMock, uploadsMockFns } from '@sim/testing/mocks/uploads.mock'
import {
  setUploadsConfig,
  uploadsConfigMock,
  uploadsConfigMockFns,
} from '@sim/testing/mocks/uploads-config.mock'
import {
  uploadsExecutionMock,
  uploadsExecutionMockFns,
} from '@sim/testing/mocks/uploads-execution.mock'
import { uploadsMetadataMock } from '@sim/testing/mocks/uploads-metadata.mock'
import { uploadsSetupMock } from '@sim/testing/mocks/uploads-setup.mock'
import {
  workspaceFileManagerMock,
  workspaceFileManagerMockFns,
} from '@sim/testing/mocks/workspace-file-manager.mock'
import {
  workspaceFileSecretProvenanceMock,
  workspaceFileSecretProvenanceMockFns,
} from '@sim/testing/mocks/workspace-file-secret-provenance.mock'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FileParserError } from '@/lib/file-parsers/errors'

const {
  mockVerifyFileAccess,
  mockVerifyWorkspaceFileAccess,
  mockPdfParseBuffer,
  mockCreateReadStream,
  mockFsAccess,
  mockFsStat,
  mockFsWriteFile,
  mockJoin,
  actualPath,
  mockReadWorkspaceFileNameByKey,
  mockResolveProvenanceSource,
  mockGetFileContentProvenance,
  storageConfig,
  mockGetBlobContainerClient,
} = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const actualPath = require('path') as typeof import('path')
  return {
    mockVerifyFileAccess: vi.fn().mockResolvedValue(true),
    mockVerifyWorkspaceFileAccess: vi.fn().mockResolvedValue(true),
    mockPdfParseBuffer: vi.fn().mockResolvedValue({
      content: 'parsed PDF content',
      metadata: { pageCount: 1 },
    }),
    mockCreateReadStream: vi.fn(),
    mockFsAccess: vi.fn().mockResolvedValue(undefined),
    mockFsStat: vi.fn().mockImplementation(() => ({ isFile: () => true, size: 17 })),
    mockFsWriteFile: vi.fn().mockResolvedValue(undefined),
    mockJoin: vi.fn((...args: string[]): string => {
      if (args[0] === '/test/uploads') {
        return `/test/uploads/${args[args.length - 1]}`
      }
      return actualPath.join(...args)
    }),
    actualPath,
    mockReadWorkspaceFileNameByKey: vi.fn(),
    mockResolveProvenanceSource: vi.fn(),
    mockGetFileContentProvenance: vi.fn(),
    storageConfig: {
      bucket: 'sim-execution-files',
      containerName: 'execution-files',
      workspaceBucket: 'sim-workspace-files',
      workspaceContainerName: 'workspace-files',
    },
    mockGetBlobContainerClient: vi.fn(),
  }
})

vi.mock('@/lib/execution/payloads/file-secret-provenance', () => ({
  resolveStoredFileProvenanceSource: mockResolveProvenanceSource,
}))

vi.mock(
  '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance',
  () => workspaceFileSecretProvenanceMock
)

vi.mock('@/lib/internal/file/operations', () => ({
  getFileContentProvenance: mockGetFileContentProvenance,
  fileContentJsonResponse: (
    body: Record<string, unknown>,
    includePrivate: boolean,
    init?: ResponseInit,
    provenance?: unknown
  ) =>
    Response.json(
      includePrivate ? { ...body, __resolvedSecretTraceProvenance: provenance } : body,
      init
    ),
}))

vi.mock('@/lib/execution/payloads/materialization.server', () => ({
  assertUserFileContentAccess: async (file: { key: string }) => {
    if (!(await mockVerifyFileAccess(file.key))) throw new Error('File not found')
  },
}))

vi.mock('@/lib/uploads', () => uploadsMock)

vi.mock('@/lib/uploads/config', () => uploadsConfigMock)

vi.mock('@/lib/uploads/providers/blob/client', () => ({
  getBlobServiceClient: async () => ({ getContainerClient: mockGetBlobContainerClient }),
}))

vi.mock('@/lib/file-parsers', () => fileParsersMock)

vi.mock('node:fs', () => ({
  createReadStream: mockCreateReadStream,
}))

vi.mock('@/lib/file-parsers/pdf-parser', () => ({
  PdfParser: class {
    parseBuffer(...args: Parameters<typeof mockPdfParseBuffer>) {
      return mockPdfParseBuffer(...args)
    }
  },
}))

vi.mock('@/lib/uploads/core/storage-service', () => storageServiceMock)

vi.mock('path', () => ({
  default: actualPath,
  ...actualPath,
  join: mockJoin,
  basename: actualPath.basename,
  extname: actualPath.extname,
}))

vi.mock('@/lib/uploads/core/setup.server', () => uploadsSetupMock)

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)

vi.mock('@/lib/core/utils/logging', () => ({
  sanitizeUrlForLog: vi.fn((url: string) => url),
}))

vi.mock('@/lib/uploads/contexts/execution', () => uploadsExecutionMock)

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => workspaceFileManagerMock)

vi.mock('@/lib/uploads/server/metadata', () => uploadsMetadataMock)

vi.mock('@/lib/workspace-files/application/read-workspace-file-name-by-key', () => ({
  readWorkspaceFileNameByKey: { execute: mockReadWorkspaceFileNameByKey },
}))

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

vi.mock('fs/promises', () => ({
  default: {
    access: mockFsAccess,
    stat: mockFsStat,
    writeFile: mockFsWriteFile,
  },
  access: mockFsAccess,
  stat: mockFsStat,
  writeFile: mockFsWriteFile,
}))

const { mockGetStorageProvider, mockIsUsingCloudStorage } = uploadsMockFns
const { mockUploadWorkspaceFile } = workspaceFileManagerMockFns
const { mockGetBoundWorkspaceFileSecretProvenance } = workspaceFileSecretProvenanceMockFns

mockUploadWorkspaceFile.mockImplementation(
  async (workspaceId: string, _userId: string, _buffer: Buffer, fileName: string) => ({
    id: 'wf_test',
    name: fileName,
    size: 0,
    type: 'application/octet-stream',
    url: `/api/files/serve/${workspaceId}/${fileName}`,
    key: `${workspaceId}/${fileName}`,
    context: 'workspace',
  })
)

import { fileParseBodySchema } from '@/lib/api/contracts/storage-transfer'
import { executeFileParserOperation } from '@/lib/internal/file/parser'
import { createWorkspaceFileDelegatedPrincipal } from '@/lib/workspace-files/application/delegated-principal'

const { mockUploadExecutionFile } = uploadsExecutionMockFns
const { mockIsSupportedFileType, mockParseBuffer } = fileParsersMockFns

mockIsSupportedFileType.mockReturnValue(true)
mockParseBuffer.mockResolvedValue({
  content: 'parsed buffer content',
  metadata: { pageCount: 1 },
})
uploadsConfigMockFns.mockGetStorageConfig.mockImplementation((context: string) =>
  context === 'workspace'
    ? {
        bucket: storageConfig.workspaceBucket,
        containerName: storageConfig.workspaceContainerName,
      }
    : storageConfig
)

function setStorageProvider(provider: 's3' | 'blob' | 'gcs'): void {
  setUploadsConfig({
    USE_S3_STORAGE: provider === 's3',
    USE_BLOB_STORAGE: provider === 'blob',
    USE_GCS_STORAGE: provider === 'gcs',
  })
}

setStorageProvider('s3')

async function POST(request: NextRequest): Promise<Response> {
  const parsed = fileParseBodySchema.safeParse(await request.json())
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? 'Invalid request data'
    return Response.json(
      { success: false, error: message, filePath: '' },
      { status: message.includes('At most 10 files') ? 413 : 400 }
    )
  }
  return executeFileParserOperation(parsed.data, {
    principal: createWorkspaceFileDelegatedPrincipal({
      serviceId: 'executor',
      subjectUserId: 'test-user-id',
      workspaceId: parsed.data.workspaceId || 'workspace-id',
      delegationId: 'test-file-parser',
    }),
    workspaceId: parsed.data.workspaceId || 'workspace-id',
    workflowId: parsed.data.workflowId || 'workflow-id',
    executionId: parsed.data.executionId || 'execution-id',
    attributedUserId: 'test-user-id',
    fileAccessUserId: 'test-user-id',
    headers: request.headers,
    signal: request.signal,
  })
}

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

describe('file parser operation', () => {
  beforeEach(() => {
    setStorageProvider('s3')
    mockGetBlobContainerClient.mockReset()
    setupFileApiMocks({
      authenticated: true,
    })

    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue({ canView: true })
    storageServiceMockFns.mockHasCloudStorage.mockReturnValue(true)
    storageServiceMockFns.mockDownloadFile.mockResolvedValue(Buffer.from('test file content'))
    mockFsStat.mockResolvedValue({ isFile: () => true, size: 17 })
    mockCreateReadStream.mockImplementation(() => Readable.from([Buffer.from('test file content')]))
    mockIsSupportedFileType.mockReturnValue(true)
    mockUploadExecutionFile.mockResolvedValue({
      id: 'file_test',
      name: 'report.pdf',
      url: '/api/files/serve/execution/report.pdf',
      size: 17,
      type: 'application/pdf',
      key: 'execution/report.pdf',
      context: 'execution',
    })
    mockReadWorkspaceFileNameByKey.mockResolvedValue({ name: null })
    mockResolveProvenanceSource.mockResolvedValue(undefined)
    mockGetBoundWorkspaceFileSecretProvenance.mockResolvedValue({ status: 'exact', entries: [] })
    mockGetFileContentProvenance.mockResolvedValue({ version: 1, complete: true, entries: [] })
    mockParseBuffer.mockResolvedValue({
      content: 'parsed buffer content',
      metadata: { pageCount: 1 },
    })
    mockPdfParseBuffer.mockResolvedValue({
      content: 'parsed PDF content',
      metadata: { pageCount: 1 },
    })
  })

  it('exports negotiated canonical execution-file lineage without changing public content', async () => {
    const source = {
      identity: {
        fileId: 'canonical-file',
        key: 'execution/workspace-id/workflow-id/execution-id/report.txt',
        context: 'execution',
        contentUpdatedAt: new Date('2026-09-10T00:00:00Z'),
      },
      ownerUserId: 'test-user-id',
    }
    mockResolveProvenanceSource.mockResolvedValue(source)
    const lineage = {
      version: 1,
      complete: true,
      scope: { userId: 'test-user-id', workspaceId: 'workspace-id' },
      entries: [{ name: 'SECRET', encryptedValue: 'encrypted-value' }],
    }
    mockGetFileContentProvenance.mockResolvedValue(lineage)

    const response = await POST(
      createMockRequest(
        'POST',
        { filePath: source.identity.key },
        { 'x-sim-request-private-tool-metadata': 'resolved-secret-provenance-v1' }
      )
    )
    const body = await response.json()

    expect(body.output.content).toBe('parsed buffer content')
    expect(body.__resolvedSecretTraceProvenance).toEqual(lineage)
    expect(body).not.toHaveProperty('provenanceSource')
    expect(body.output).not.toHaveProperty('provenanceSource')
    expect(mockGetFileContentProvenance).toHaveBeenCalledWith(
      expect.any(Object),
      'workspace-id',
      [source],
      expect.any(AbortSignal)
    )
    expect(mockUploadExecutionFile).not.toHaveBeenCalled()
  })

  it('keeps private canonical provenance out of unnegotiated parser responses', async () => {
    mockResolveProvenanceSource.mockResolvedValue({
      identity: { fileId: 'canonical-file', key: 'workspace/report.txt', context: 'workspace' },
      ownerUserId: 'test-user-id',
    })
    const response = await POST(createMockRequest('POST', { filePath: 'workspace/report.txt' }))
    const body = await response.json()

    expect(body.output.content).toBe('parsed buffer content')
    expect(body).not.toHaveProperty('__resolvedSecretTraceProvenance')
    expect(body).not.toHaveProperty('provenanceSource')
    expect(mockGetFileContentProvenance).not.toHaveBeenCalled()
  })

  it('does not return content when canonical provenance resolution rejects the file scope', async () => {
    mockResolveProvenanceSource.mockRejectedValue(new Error('File not found'))
    const response = await POST(createMockRequest('POST', { filePath: 'workspace/other.txt' }))

    expect((await response.json()).success).toBe(false)
    expect(storageServiceMockFns.mockDownloadFile).not.toHaveBeenCalled()
    expect(mockUploadExecutionFile).not.toHaveBeenCalled()
  })

  it('does not fall back to external ingress when configured storage resolution fails', async () => {
    setStorageProvider('blob')
    mockGetBlobContainerClient.mockImplementation(() => {
      throw new Error('Storage configuration unavailable')
    })

    const response = await POST(
      createMockRequest('POST', {
        filePath:
          'https://exampleaccount.blob.core.windows.net/workspace-files/workspace/workspace-id/report.txt',
      })
    )

    expect((await response.json()).success).toBe(false)
    expect(inputValidationMockFns.mockSecureFetchWithPinnedIP).not.toHaveBeenCalled()
    expect(mockUploadExecutionFile).not.toHaveBeenCalled()
  })

  it.each([
    'https://exampleaccount.blob.core.windows.net.attacker.test/execution-files',
    'https://exampleaccount.blob.core.windows.net/execution-files-other',
  ])(
    'does not attribute another Azure origin or container to owned storage: %s',
    async (containerUrl) => {
      setStorageProvider('blob')
      mockGetBlobContainerClient.mockReturnValue({
        url: 'https://exampleaccount.blob.core.windows.net/execution-files',
      })
      inputValidationMockFns.mockSecureFetchWithPinnedIP.mockResolvedValue(
        new Response('external content', { headers: { 'content-type': 'text/plain' } })
      )
      await POST(createMockRequest('POST', { filePath: `${containerUrl}/report.txt` }))

      expect(mockResolveProvenanceSource).not.toHaveBeenCalled()
      expect(storageServiceMockFns.mockDownloadFile).not.toHaveBeenCalled()
    }
  )

  it('does not attribute an external hostname prefix to canonical storage provenance', async () => {
    inputValidationMockFns.mockSecureFetchWithPinnedIP.mockResolvedValue(
      new Response('external content', { headers: { 'content-type': 'text/plain' } })
    )
    await POST(
      createMockRequest('POST', {
        filePath:
          'https://sim-execution-files.s3.us-east-1.amazonaws.com.attacker.test/execution/workspace-id/workflow-id/execution-id/report.txt',
      })
    )

    expect(mockResolveProvenanceSource).not.toHaveBeenCalled()
    expect(storageServiceMockFns.mockDownloadFile).not.toHaveBeenCalled()
  })

  it.each([{ filePath: 'workspace/failed.txt' }, { filePath: ['workspace/failed.txt'] }])(
    'keeps failed parser provenance out of the public payload for %j',
    async ({ filePath }) => {
      mockResolveProvenanceSource.mockResolvedValue({
        identity: { fileId: 'private-source', key: 'workspace/failed.txt', context: 'workspace' },
        ownerUserId: 'private-owner',
      })
      mockGetBoundWorkspaceFileSecretProvenance.mockResolvedValue({
        status: 'exact',
        entries: [{ name: 'SECRET', encryptedValue: 'private-ciphertext' }],
      })
      mockParseBuffer.mockResolvedValue({
        content: 'discarded parser output',
        metadata: { degraded: true, warning: 'Unable to parse format' },
      })

      const response = await POST(
        createMockRequest(
          'POST',
          { filePath },
          { 'x-sim-request-private-tool-metadata': 'resolved-secret-provenance-v1' }
        )
      )
      const body = await response.json()
      const serialized = JSON.stringify(body)

      expect(Array.isArray(filePath) ? body.results[0].success : body.success).toBe(false)
      for (const privateValue of [
        'provenanceSource',
        'private-source',
        'private-owner',
        'private-ciphertext',
        'discarded parser output',
      ]) {
        expect(serialized).not.toContain(privateValue)
      }
      for (const call of mockGetFileContentProvenance.mock.calls) {
        expect(call[2]).toEqual([])
      }
    }
  )

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

  /**
   * A parser that could only scrape bytes flags its output `degraded`; the tool
   * must report that as a failure rather than hand placeholder prose to the model.
   */
  it('reports degraded parser output as a failure instead of returning it as content', async () => {
    setupFileApiMocks({
      cloudEnabled: false,
      storageProvider: 'local',
      authenticated: true,
    })
    mockParseBuffer.mockResolvedValue({
      content: 'Unable to extract text from DOC file. Please convert to DOCX format.',
      metadata: { degraded: true, warning: 'Basic text extraction used' },
    })
    const req = createMockRequest('POST', {
      filePath: 'workspace/legacy.doc',
    })

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(false)
    expect(data.error).toContain('Could not extract text from legacy.doc')
    expect(data.error).toContain('Basic text extraction used')
    expect(JSON.stringify(data)).not.toContain('Unable to extract text from DOC file')
    expect(mockUploadExecutionFile).not.toHaveBeenCalled()
  })

  it('should reject parser complexity limits instead of returning raw text', async () => {
    setupFileApiMocks({
      cloudEnabled: true,
      storageProvider: 's3',
      authenticated: true,
    })
    storageServiceMockFns.mockDownloadFile.mockResolvedValue(Buffer.from('{"value":true}'))
    mockParseBuffer.mockRejectedValueOnce(
      new FileParserError('complexity_limit', 'JSON document exceeds the complexity limit')
    )

    const req = createMockRequest('POST', {
      filePath: '/api/files/serve/execution/workspace-1/workflow-1/execution-1/data.json',
    })

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(false)
    expect(data.error).toContain('complexity limit')
    expect(data).not.toHaveProperty('output')
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
    expect(mockCreateReadStream).not.toHaveBeenCalled()
    expect(mockParseBuffer).not.toHaveBeenCalled()
    expect(mockUploadExecutionFile).not.toHaveBeenCalled()
  })
})

describe('Files Parse API - Path Traversal Security', () => {
  beforeEach(() => {
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
})
