/**
 * @vitest-environment node
 */
import { createMockRequest, hybridAuthMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAssertActiveWorkspaceAccess,
  mockAssertToolFileAccess,
  mockDownloadServableFileFromStorage,
  mockGetBoundWorkspaceFileSecretProvenance,
  mockGetFileMetadataByKey,
  mockGetWorkspaceFile,
} = vi.hoisted(() => ({
  mockAssertActiveWorkspaceAccess: vi.fn(),
  mockAssertToolFileAccess: vi.fn(),
  mockDownloadServableFileFromStorage: vi.fn(),
  mockGetBoundWorkspaceFileSecretProvenance: vi.fn(),
  mockGetFileMetadataByKey: vi.fn(),
  mockGetWorkspaceFile: vi.fn(),
}))

vi.mock('@/lib/file-parsers', () => ({
  isSupportedFileType: vi.fn(() => false),
  parseBuffer: vi.fn(),
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  fetchWorkspaceFileBuffer: vi.fn(),
  getWorkspaceFile: (...args: unknown[]) => mockGetWorkspaceFile(...args),
  resolveWorkspaceFileReference: vi.fn(),
  updateWorkspaceFileContent: vi.fn(),
  uploadWorkspaceFile: vi.fn(),
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-secret-provenance', () => ({
  getBoundWorkspaceFileSecretProvenance: (...args: unknown[]) =>
    mockGetBoundWorkspaceFileSecretProvenance(...args),
}))

vi.mock('@/lib/uploads/server/metadata', () => ({
  getFileMetadataByKey: (...args: unknown[]) => mockGetFileMetadataByKey(...args),
}))

vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  downloadFileFromStorage: vi.fn(),
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
    mockDownloadServableFileFromStorage.mockImplementation(async (file: { name: string }) => ({
      buffer: Buffer.from(`content:${file.name}`),
    }))
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
