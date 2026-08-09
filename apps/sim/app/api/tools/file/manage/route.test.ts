/**
 * @vitest-environment node
 */
import { createMockRequest, hybridAuthMockFns } from '@sim/testing'
import JSZip from 'jszip'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAssertActiveWorkspaceAccess,
  mockAssertToolFileAccess,
  mockDownloadServableFileFromStorage,
  mockDownloadFileFromStorage,
  mockEnsureWorkspaceFileFolderPath,
  mockFetchWorkspaceFileBuffer,
  mockGetBoundWorkspaceFileSecretProvenance,
  mockGetFileMetadataByKey,
  mockGetWorkspaceFile,
  mockResolveWorkspaceFileReference,
  mockUpdateWorkspaceFileContent,
  mockUploadWorkspaceFile,
} = vi.hoisted(() => ({
  mockAssertActiveWorkspaceAccess: vi.fn(),
  mockAssertToolFileAccess: vi.fn(),
  mockDownloadServableFileFromStorage: vi.fn(),
  mockDownloadFileFromStorage: vi.fn(),
  mockEnsureWorkspaceFileFolderPath: vi.fn(),
  mockFetchWorkspaceFileBuffer: vi.fn(),
  mockGetBoundWorkspaceFileSecretProvenance: vi.fn(),
  mockGetFileMetadataByKey: vi.fn(),
  mockGetWorkspaceFile: vi.fn(),
  mockResolveWorkspaceFileReference: vi.fn(),
  mockUpdateWorkspaceFileContent: vi.fn(),
  mockUploadWorkspaceFile: vi.fn(),
}))

vi.mock('@/lib/file-parsers', () => ({
  isSupportedFileType: vi.fn(() => false),
  parseBuffer: vi.fn(),
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  fetchWorkspaceFileBuffer: (...args: unknown[]) => mockFetchWorkspaceFileBuffer(...args),
  getWorkspaceFile: (...args: unknown[]) => mockGetWorkspaceFile(...args),
  resolveWorkspaceFileReference: (...args: unknown[]) => mockResolveWorkspaceFileReference(...args),
  updateWorkspaceFileContent: (...args: unknown[]) => mockUpdateWorkspaceFileContent(...args),
  uploadWorkspaceFile: (...args: unknown[]) => mockUploadWorkspaceFile(...args),
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-folder-manager', () => ({
  ensureWorkspaceFileFolderPath: (...args: unknown[]) => mockEnsureWorkspaceFileFolderPath(...args),
}))

vi.mock('@/lib/core/config/redis', () => ({
  acquireLock: vi.fn(async () => true),
  releaseLock: vi.fn(async () => undefined),
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-secret-provenance', () => ({
  getBoundWorkspaceFileSecretProvenance: (...args: unknown[]) =>
    mockGetBoundWorkspaceFileSecretProvenance(...args),
  mergeWorkspaceFileSecretProvenance: (
    ...provenances: Array<
      | { status: 'exact'; entries: Array<{ name: string; encryptedValue: string }> }
      | {
          status: 'unknown'
        }
    >
  ) =>
    provenances.some((provenance) => provenance.status === 'unknown')
      ? { status: 'unknown' }
      : {
          status: 'exact',
          entries: provenances.flatMap((provenance) =>
            provenance.status === 'exact' ? provenance.entries : []
          ),
        },
}))

vi.mock('@/lib/uploads/server/metadata', () => ({
  getFileMetadataByKey: (...args: unknown[]) => mockGetFileMetadataByKey(...args),
}))

vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  downloadFileFromStorage: (...args: unknown[]) => mockDownloadFileFromStorage(...args),
  downloadServableFileFromStorage: (...args: unknown[]) =>
    mockDownloadServableFileFromStorage(...args),
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  assertActiveWorkspaceAccess: (...args: unknown[]) => mockAssertActiveWorkspaceAccess(...args),
  getUserEntityPermissions: vi.fn(),
  isWorkspaceAccessDeniedError: vi.fn(() => false),
}))

vi.mock('@/app/api/files/authorization', () => ({
  assertToolFileAccess: (...args: unknown[]) => mockAssertToolFileAccess(...args),
}))

import { POST } from '@/app/api/tools/file/manage/route'

const PRIVATE_REQUEST_HEADER = {
  'x-sim-request-private-tool-metadata': 'resolved-secret-provenance-v1',
}
const PRIVATE_SECRET_PROVENANCE_HEADER = {
  'x-sim-private-secret-provenance': 'private-secret-provenance-bundle-v1',
}
const CONTENT_UPDATED_AT = new Date('2026-08-04T00:00:00.000Z')

function workspaceFile(id: string, ownerUserId = 'user-1') {
  return {
    id,
    workspaceId: 'workspace-1',
    name: `${id}.txt`,
    key: `workspace/workspace-1/${id}.txt`,
    path: `/api/files/serve/${id}`,
    size: id.length,
    type: 'text/plain',
    uploadedBy: ownerUserId,
    uploadedAt: CONTENT_UPDATED_AT,
    updatedAt: CONTENT_UPDATED_AT,
    contentUpdatedAt: CONTENT_UPDATED_AT,
  }
}

describe('POST /api/tools/file/manage content provenance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hybridAuthMockFns.mockCheckInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-1',
      authType: 'internal_jwt',
    })
    mockAssertActiveWorkspaceAccess.mockResolvedValue(undefined)
    mockAssertToolFileAccess.mockResolvedValue(undefined)
    mockEnsureWorkspaceFileFolderPath.mockResolvedValue(null)
    mockDownloadServableFileFromStorage.mockImplementation(async (file: { name: string }) => ({
      buffer: Buffer.from(`content:${file.name}`),
    }))
    mockFetchWorkspaceFileBuffer.mockResolvedValue(Buffer.from('before'))
    mockUploadWorkspaceFile.mockResolvedValue({
      id: 'new-file',
      name: 'new.txt',
      key: 'workspace/workspace-1/new.txt',
      url: '/api/files/serve/new-file',
    })
  })

  it('returns a scoped, deduplicated union of exact canonical file provenance', async () => {
    mockGetWorkspaceFile.mockImplementation(async (_workspaceId: string, fileId: string) =>
      workspaceFile(fileId)
    )
    mockGetBoundWorkspaceFileSecretProvenance.mockImplementation(
      async (_workspaceId: string, identity: { fileId: string }) =>
        identity.fileId === 'file-1'
          ? {
              status: 'exact',
              entries: [
                { name: 'TOKEN', encryptedValue: 'encrypted-token' },
                { name: 'ALPHA', encryptedValue: 'encrypted-alpha' },
              ],
            }
          : {
              status: 'exact',
              entries: [{ name: 'TOKEN', encryptedValue: 'encrypted-token' }],
            }
    )

    const response = await POST(
      createMockRequest(
        'POST',
        { operation: 'content', workspaceId: 'workspace-1', fileId: ['file-1', 'file-2'] },
        PRIVATE_REQUEST_HEADER
      )
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('x-sim-private-tool-metadata')).toBe(
      'resolved-secret-provenance-v1'
    )
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: { contents: ['content:file-1.txt', 'content:file-2.txt'] },
      __resolvedSecretTraceProvenance: {
        version: 1,
        complete: true,
        entries: [
          { name: 'ALPHA', encryptedValue: 'encrypted-alpha' },
          { name: 'TOKEN', encryptedValue: 'encrypted-token' },
        ],
        scope: { userId: 'user-1', workspaceId: 'workspace-1' },
      },
    })
  })

  it('stores exact causal provenance from a different user in the actor workspace', async () => {
    const response = await POST(
      createMockRequest(
        'POST',
        {
          operation: 'write',
          workspaceId: 'workspace-1',
          fileName: 'new.txt',
          content: 'secret-value',
          __privateSecretProvenance: {
            version: 1,
            complete: true,
            selections: [
              {
                key: 'content',
                provenance: {
                  version: 1,
                  complete: true,
                  entries: [{ name: 'TOKEN', encryptedValue: 'encrypted-token' }],
                  scope: { userId: 'workflow-owner', workspaceId: 'workspace-1' },
                },
              },
            ],
          },
        },
        PRIVATE_SECRET_PROVENANCE_HEADER
      )
    )

    expect(response.status).toBe(200)
    expect(mockUploadWorkspaceFile).toHaveBeenCalledWith(
      'workspace-1',
      'user-1',
      Buffer.from('secret-value'),
      'new.txt',
      'text/plain',
      {
        folderId: null,
        secretProvenance: {
          status: 'exact',
          entries: [
            {
              name: 'TOKEN',
              encryptedValue: 'encrypted-token',
              sourceUserId: 'workflow-owner',
              sourceWorkspaceId: 'workspace-1',
            },
          ],
        },
      }
    )
  })

  it('rejects file-write provenance from another workspace', async () => {
    const response = await POST(
      createMockRequest(
        'POST',
        {
          operation: 'write',
          workspaceId: 'workspace-1',
          fileName: 'new.txt',
          content: 'secret-value',
          __privateSecretProvenance: {
            version: 1,
            complete: true,
            selections: [
              {
                key: 'content',
                provenance: {
                  version: 1,
                  complete: true,
                  entries: [{ name: 'TOKEN', encryptedValue: 'encrypted-token' }],
                  scope: { userId: 'workflow-owner', workspaceId: 'workspace-2' },
                },
              },
            ],
          },
        },
        PRIVATE_SECRET_PROVENANCE_HEADER
      )
    )

    expect(response.status).toBe(400)
    expect(mockUploadWorkspaceFile).not.toHaveBeenCalled()
  })

  it('preserves existing file-path behavior when a filename was resolved from a secret', async () => {
    const response = await POST(
      createMockRequest(
        'POST',
        {
          operation: 'write',
          workspaceId: 'workspace-1',
          fileName: 'Reports/secret-value.txt',
          content: 'ordinary text',
          __privateSecretProvenance: {
            version: 1,
            complete: true,
            selections: [
              {
                key: 'content',
                provenance: {
                  version: 1,
                  complete: true,
                  entries: [],
                  scope: { userId: 'user-1', workspaceId: 'workspace-1' },
                },
              },
            ],
          },
        },
        PRIVATE_SECRET_PROVENANCE_HEADER
      )
    )

    expect(response.status).toBe(200)
    expect(mockEnsureWorkspaceFileFolderPath).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      pathSegments: ['Reports'],
    })
    expect(mockUploadWorkspaceFile).toHaveBeenCalledWith(
      'workspace-1',
      'user-1',
      Buffer.from('ordinary text'),
      'secret-value.txt',
      'text/plain',
      {
        folderId: null,
        secretProvenance: { status: 'exact', entries: [] },
      }
    )
  })

  it('keeps a headerless file write on the legacy untracked path', async () => {
    const response = await POST(
      createMockRequest('POST', {
        operation: 'write',
        workspaceId: 'workspace-1',
        fileName: 'new.txt',
        content: 'ordinary text',
      })
    )

    expect(response.status).toBe(200)
    expect(mockUploadWorkspaceFile).toHaveBeenCalledWith(
      'workspace-1',
      'user-1',
      Buffer.from('ordinary text'),
      'new.txt',
      'text/plain',
      { folderId: null }
    )
  })

  it('persists an authenticated file write with unavailable lineage as unknown', async () => {
    const response = await POST(
      createMockRequest(
        'POST',
        {
          operation: 'write',
          workspaceId: 'workspace-1',
          fileName: 'new.txt',
          content: 'possibly secret',
          __privateSecretProvenance: {
            version: 1,
            complete: false,
            selections: [],
          },
        },
        PRIVATE_SECRET_PROVENANCE_HEADER
      )
    )

    expect(response.status).toBe(200)
    expect(mockUploadWorkspaceFile).toHaveBeenCalledWith(
      'workspace-1',
      'user-1',
      Buffer.from('possibly secret'),
      'new.txt',
      'text/plain',
      {
        folderId: null,
        secretProvenance: { status: 'unknown' },
      }
    )
  })

  it('atomically binds append provenance to the exact predecessor version', async () => {
    const existing = workspaceFile('file-1')
    mockResolveWorkspaceFileReference.mockResolvedValue(existing)
    mockGetBoundWorkspaceFileSecretProvenance.mockResolvedValue({
      status: 'exact',
      entries: [
        {
          name: 'OLD',
          encryptedValue: 'encrypted-old',
          sourceUserId: 'user-1',
          sourceWorkspaceId: 'workspace-1',
        },
      ],
    })

    const response = await POST(
      createMockRequest(
        'POST',
        {
          operation: 'append',
          workspaceId: 'workspace-1',
          fileName: 'file-1.txt',
          content: 'secret-value',
          __privateSecretProvenance: {
            version: 1,
            complete: true,
            selections: [
              {
                key: 'content',
                provenance: {
                  version: 1,
                  complete: true,
                  entries: [{ name: 'NEW', encryptedValue: 'encrypted-new' }],
                  scope: { userId: 'user-1', workspaceId: 'workspace-1' },
                },
              },
            ],
          },
        },
        PRIVATE_SECRET_PROVENANCE_HEADER
      )
    )

    expect(response.status).toBe(200)
    expect(mockUpdateWorkspaceFileContent).toHaveBeenCalledWith(
      'workspace-1',
      'file-1',
      'user-1',
      Buffer.from('beforesecret-value'),
      undefined,
      {
        expectedUpdatedAt: CONTENT_UPDATED_AT,
        secretProvenancePolicy: {
          mode: 'replace',
          provenance: {
            status: 'exact',
            entries: [
              {
                name: 'OLD',
                encryptedValue: 'encrypted-old',
                sourceUserId: 'user-1',
                sourceWorkspaceId: 'workspace-1',
              },
              {
                name: 'NEW',
                encryptedValue: 'encrypted-new',
                sourceUserId: 'user-1',
                sourceWorkspaceId: 'workspace-1',
              },
            ],
          },
        },
      }
    )
  })

  it('preserves the prior classification for a legacy headerless append', async () => {
    const existing = workspaceFile('file-1')
    mockResolveWorkspaceFileReference.mockResolvedValue(existing)
    mockGetBoundWorkspaceFileSecretProvenance.mockResolvedValue({
      status: 'exact',
      entries: [{ name: 'OLD', encryptedValue: 'encrypted-old' }],
    })

    const response = await POST(
      createMockRequest('POST', {
        operation: 'append',
        workspaceId: 'workspace-1',
        fileName: 'file-1.txt',
        content: 'ordinary text',
      })
    )

    expect(response.status).toBe(200)
    expect(mockUpdateWorkspaceFileContent).toHaveBeenCalledWith(
      'workspace-1',
      'file-1',
      'user-1',
      Buffer.from('beforeordinary text'),
      undefined,
      {
        expectedUpdatedAt: CONTENT_UPDATED_AT,
        secretProvenancePolicy: { mode: 'preserve' },
      }
    )
  })

  it('carries the union of source provenance into a compressed archive', async () => {
    mockGetWorkspaceFile.mockResolvedValue(workspaceFile('file-1'))
    mockGetBoundWorkspaceFileSecretProvenance.mockResolvedValue({
      status: 'exact',
      entries: [{ name: 'TOKEN', encryptedValue: 'encrypted-token' }],
    })

    const response = await POST(
      createMockRequest('POST', {
        operation: 'compress',
        workspaceId: 'workspace-1',
        fileId: 'file-1',
        archiveName: 'bundle',
      })
    )

    expect(response.status).toBe(200)
    expect(mockUploadWorkspaceFile).toHaveBeenCalledWith(
      'workspace-1',
      'user-1',
      expect.any(Buffer),
      'bundle.zip',
      'application/zip',
      {
        folderId: null,
        secretProvenance: {
          status: 'exact',
          entries: [{ name: 'TOKEN', encryptedValue: 'encrypted-token' }],
        },
      }
    )
  })

  it('extracts a secret-bearing archive with unknown output provenance', async () => {
    const zip = new JSZip()
    zip.file('child.txt', 'secret-value')
    mockDownloadFileFromStorage.mockResolvedValue(
      Buffer.from(await zip.generateAsync({ type: 'uint8array' }))
    )
    mockGetWorkspaceFile.mockResolvedValue({
      ...workspaceFile('archive'),
      name: 'archive.zip',
      type: 'application/zip',
    })
    mockGetBoundWorkspaceFileSecretProvenance.mockResolvedValue({
      status: 'exact',
      entries: [{ name: 'TOKEN', encryptedValue: 'encrypted-token' }],
    })

    const response = await POST(
      createMockRequest('POST', {
        operation: 'decompress',
        workspaceId: 'workspace-1',
        fileId: 'archive',
      })
    )

    expect(response.status).toBe(200)
    expect(mockDownloadFileFromStorage).toHaveBeenCalledTimes(1)
    expect(mockUploadWorkspaceFile).toHaveBeenCalledWith(
      'workspace-1',
      'user-1',
      Buffer.from('secret-value'),
      'child.txt',
      'text/plain',
      {
        folderId: null,
        secretProvenance: { status: 'unknown' },
      }
    )
  })

  it('omits source scope when canonical files have different owners', async () => {
    mockGetWorkspaceFile.mockImplementation(async (_workspaceId: string, fileId: string) =>
      workspaceFile(fileId, fileId === 'file-1' ? 'user-1' : 'user-2')
    )
    mockGetBoundWorkspaceFileSecretProvenance.mockResolvedValue({
      status: 'exact',
      entries: [{ name: 'TOKEN', encryptedValue: 'encrypted-token' }],
    })

    const response = await POST(
      createMockRequest(
        'POST',
        { operation: 'content', workspaceId: 'workspace-1', fileId: ['file-1', 'file-2'] },
        PRIVATE_REQUEST_HEADER
      )
    )
    const body = await response.json()

    expect(body.__resolvedSecretTraceProvenance).toEqual({
      version: 1,
      complete: true,
      entries: [{ name: 'TOKEN', encryptedValue: 'encrypted-token' }],
    })
  })

  it('returns incomplete provenance for an input that cannot bind to a canonical file row', async () => {
    mockGetFileMetadataByKey.mockResolvedValue(null)

    const response = await POST(
      createMockRequest(
        'POST',
        {
          operation: 'content',
          workspaceId: 'workspace-1',
          fileInput: {
            key: 'workspace/workspace-1/unbound.txt',
            name: 'unbound.txt',
            type: 'text/plain',
            size: 7,
          },
        },
        PRIVATE_REQUEST_HEADER
      )
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      __resolvedSecretTraceProvenance: { version: 1, complete: false, entries: [] },
    })
    expect(mockGetBoundWorkspaceFileSecretProvenance).not.toHaveBeenCalled()
  })

  it('keeps a normal not-found error while returning a valid private envelope', async () => {
    mockGetWorkspaceFile.mockResolvedValue(null)

    const response = await POST(
      createMockRequest(
        'POST',
        { operation: 'content', workspaceId: 'workspace-1', fileId: 'missing-file' },
        PRIVATE_REQUEST_HEADER
      )
    )

    expect(response.status).toBe(404)
    expect(response.headers.get('x-sim-private-tool-metadata')).toBe(
      'resolved-secret-provenance-v1'
    )
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'File not found: "missing-file"',
      __resolvedSecretTraceProvenance: { version: 1, complete: true, entries: [] },
    })
  })

  it('does not add private transport fields when provenance was not requested', async () => {
    mockGetWorkspaceFile.mockResolvedValue(workspaceFile('file-1'))

    const response = await POST(
      createMockRequest('POST', {
        operation: 'content',
        workspaceId: 'workspace-1',
        fileId: 'file-1',
      })
    )

    expect(response.headers.get('x-sim-private-tool-metadata')).toBeNull()
    const body = await response.json()
    expect(body).not.toHaveProperty('__resolvedSecretTraceProvenance')
    expect(mockGetBoundWorkspaceFileSecretProvenance).not.toHaveBeenCalled()
  })
})
