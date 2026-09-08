/**
 * @vitest-environment node
 */
import { type StoredWorkspaceFileSecretProvenanceEntry, workspaceFiles } from '@sim/db/schema'
import {
  auditMock,
  createMockRequest,
  dbChainMock,
  dbChainMockFns,
  queueTableRows,
  resetDbChainMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockEnforced,
  mockAssertActiveWorkspaceAccess,
  mockFetchWorkspaceFileBuffer,
  mockLoadActiveWorkspaceContext,
  mockLoadActiveWorkspaceFileContext,
  mockResolveEffectiveWorkspacePermission,
  mockGetWorkspaceFile,
  mockResolveWorkspaceFileReference,
  mockUpdateWorkspaceFileContent,
} = vi.hoisted(() => ({
  mockEnforced: vi.fn(() => false),
  mockAssertActiveWorkspaceAccess: vi.fn(),
  mockFetchWorkspaceFileBuffer: vi.fn(),
  mockLoadActiveWorkspaceContext: vi.fn(),
  mockLoadActiveWorkspaceFileContext: vi.fn(),
  mockResolveEffectiveWorkspacePermission: vi.fn(),
  mockGetWorkspaceFile: vi.fn(),
  mockResolveWorkspaceFileReference: vi.fn(),
  mockUpdateWorkspaceFileContent: vi.fn(),
}))

vi.mock('@/lib/uploads/archive', () => ({
  ArchiveError: class ArchiveError extends Error {},
  decompressArchiveBufferToWorkspaceFiles: vi.fn(),
  MAX_ARCHIVE_BYTES: 104_857_600,
  statusForArchiveError: () => 400,
}))

vi.mock('@/lib/file-parsers', () => ({
  isSupportedFileType: vi.fn(() => false),
  parseBuffer: vi.fn(),
}))

vi.mock('@sim/audit', () => auditMock)

vi.mock('@/lib/realtime/notify', () => ({
  notifyWorkspaceFilesChanged: vi.fn(async () => undefined),
}))

vi.mock('@/lib/public-shares/share-manager', () => ({
  getShareForResource: vi.fn().mockResolvedValue(null),
  getSharesForResources: vi.fn().mockResolvedValue(new Map()),
  getWorkspaceSharesForResources: vi.fn().mockResolvedValue(new Map()),
  ShareValidationError: class ShareValidationError extends Error {},
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (permission: string | null, required: string) =>
    permission === 'admin' ||
    permission === required ||
    (permission === 'write' && required === 'read'),
  resolveEffectiveWorkspacePermission: (...args: unknown[]) =>
    mockResolveEffectiveWorkspacePermission(...args),
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  fetchWorkspaceFileBuffer: (...args: unknown[]) => mockFetchWorkspaceFileBuffer(...args),
  getWorkspaceFileByName: vi.fn(),
  getWorkspaceFile: (...args: unknown[]) => mockGetWorkspaceFile(...args),
  loadActiveWorkspaceContext: (...args: unknown[]) => mockLoadActiveWorkspaceContext(...args),
  loadActiveWorkspaceFileContext: (...args: unknown[]) =>
    mockLoadActiveWorkspaceFileContext(...args),
  normalizeWorkspaceFileItemName: (name: string) => {
    const trimmed = name.trim()
    if (!trimmed || trimmed === '.' || trimmed === '..' || /[/\\]/.test(trimmed)) {
      throw new Error('Invalid file name')
    }
    return trimmed
  },
  resolveWorkspaceFileReference: (...args: unknown[]) => mockResolveWorkspaceFileReference(...args),
  updateWorkspaceFileContent: (...args: unknown[]) => mockUpdateWorkspaceFileContent(...args),
  uploadWorkspaceFile: vi.fn(),
}))

vi.mock('@/lib/uploads/contexts/workspace', () => ({
  FileConflictError: class FileConflictError extends Error {},
  ContentVersionConflictError: class ContentVersionConflictError extends Error {},
  fetchWorkspaceFileBuffer: (...args: unknown[]) => mockFetchWorkspaceFileBuffer(...args),
  getWorkspaceFileByName: vi.fn(),
  getWorkspaceFile: (...args: unknown[]) => mockGetWorkspaceFile(...args),
  loadActiveWorkspaceContext: (...args: unknown[]) => mockLoadActiveWorkspaceContext(...args),
  updateWorkspaceFileContent: (...args: unknown[]) => mockUpdateWorkspaceFileContent(...args),
  uploadWorkspaceFile: vi.fn(),
}))

vi.mock('@/lib/workspace-files/application/workspace-file-folders', () => ({
  ensureWorkspaceFileFolderPathOperation: {
    execute: vi.fn(),
  },
  listWorkspaceFileFoldersOperation: {
    execute: vi.fn(),
  },
  createWorkspaceFileFolderOperation: {
    execute: vi.fn(),
  },
  updateWorkspaceFileFolderOperation: {
    execute: vi.fn(),
  },
  deleteWorkspaceFileFolderOperation: {
    execute: vi.fn(),
  },
  restoreWorkspaceFileFolderOperation: {
    execute: vi.fn(),
  },
}))

vi.mock('@/lib/workspace-files/application/edit-workspace-file-content', () => ({
  editWorkspaceFileContent: {
    execute: vi.fn(),
  },
}))

vi.mock('@/lib/workspace-files/application/list-workspace-files', () => ({
  listWorkspaceFilesInFolderScope: {
    execute: vi.fn(),
  },
  queryWorkspaceFilePage: {
    execute: vi.fn(),
  },
}))

vi.mock('@/lib/workspace-files/application/move-workspace-file-items', () => ({
  moveWorkspaceFileItemsOperation: {
    execute: vi.fn(),
  },
}))

vi.mock('@/lib/core/config/redis', () => ({
  acquireLock: vi.fn(async () => true),
  releaseLock: vi.fn(async () => undefined),
}))

vi.mock('@/lib/uploads/server/metadata', () => ({
  getFileMetadataByKey: vi.fn(),
}))

vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  downloadFileFromStorage: vi.fn(),
  downloadServableFileFromStorage: vi.fn(),
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  assertActiveWorkspaceAccess: (...args: unknown[]) => mockAssertActiveWorkspaceAccess(...args),
  getUserEntityPermissions: vi.fn(),
  isWorkspaceAccessDeniedError: vi.fn(() => false),
}))

vi.mock('@/app/api/files/authorization', () => ({
  verifyFileAccess: vi.fn(),
}))

vi.mock('@/lib/execution/durable-secret-provenance-enforcement', () => ({
  isDurableSecretProvenanceEnforced: mockEnforced,
  reportUnrecordedDurableProvenance: vi.fn(),
  reportDurableSecretProvenanceWrite: vi.fn(),
  reportDurableSecretProvenanceRefusal: vi.fn(),
}))
vi.mock('@/lib/core/security/encryption', () => ({
  decryptSecret: vi.fn(async () => ({ decrypted: 'synthetic-known-secret-123' })),
  encryptSecret: vi.fn(async () => ({ encrypted: 'synthetic-ciphertext' })),
}))

import { fileManageBodySchema } from '@/lib/api/contracts/tools/file'
import type { DbTransaction } from '@/lib/db/types'
import { executeFileManageOperation } from '@/lib/internal/file/operations'
import {
  importWorkspaceFileSecretProvenanceForModelView,
  isOpaqueWorkspaceFileEgressSafe,
  replaceWorkspaceFileSecretProvenanceInTx,
  type WorkspaceFileSecretProvenance,
} from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import { createWorkspaceFileDelegatedPrincipal } from '@/lib/workspace-files/application/delegated-principal'
import { projectResolvedSecretModelContent } from '@/executor/utils/resolved-secret-content-projection'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

async function executeAppend(request: Request): Promise<Response> {
  const parsed = fileManageBodySchema.parse(await request.json())
  const workspaceId = parsed.workspaceId || 'workspace-1'
  return executeFileManageOperation(parsed, {
    principal: createWorkspaceFileDelegatedPrincipal({
      serviceId: 'executor',
      subjectUserId: 'user-1',
      workspaceId,
      delegationId: 'test-file-operation',
    }),
    workspaceId,
    attributedUserId: 'user-1',
    fileAccessUserId: 'user-1',
    workflowId: 'workflow-1',
    headers: request.headers,
    requestId: 'request-1',
    signal: request.signal,
  })
}

const PRIVATE_SECRET_PROVENANCE_HEADER = {
  'x-sim-private-secret-provenance': 'private-secret-provenance-bundle-v1',
}
const CONTENT_UPDATED_AT = new Date('2026-08-04T00:00:00.000Z')
const NEXT_CONTENT_UPDATED_AT = new Date('2026-08-04T00:00:01.000Z')

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

const SECRET = 'synthetic-known-secret-123'
const SCOPE = { userId: 'user-1', workspaceId: 'workspace-1' }
const IDENTITY = {
  fileId: 'file-1',
  key: 'workspace/workspace-1/file-1.txt',
  context: 'workspace' as const,
}
function joinedRow(status: string, entries: unknown[] = [], contentUpdatedAt = CONTENT_UPDATED_AT) {
  return {
    fileContentUpdatedAt: contentUpdatedAt,
    secretProvenanceVersion: 1,
    provenanceContentUpdatedAt: contentUpdatedAt,
    status,
    entries,
  }
}

/**
 * Runs the append adapter, authorized use cases, sidecar writer, bound readers and model projector.
 * Storage/context/auth lookups and SQL transport are mocked; captured sidecar insertion values
 * supply the reader fixture so the production merge and classification remain under test.
 */
describe('appended file provenance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockEnforced.mockReturnValue(false)
    dbChainMockFns.returning.mockResolvedValue([{ id: 'file-1' }])
    mockResolveEffectiveWorkspacePermission.mockResolvedValue('write')
    mockLoadActiveWorkspaceContext.mockResolvedValue({
      workspaceId: 'workspace-1',
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'user-1',
    })
    mockLoadActiveWorkspaceFileContext.mockResolvedValue({
      fileId: 'file-1',
      workspaceId: 'workspace-1',
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'user-1',
    })
    mockAssertActiveWorkspaceAccess.mockResolvedValue(undefined)
    mockGetWorkspaceFile.mockResolvedValue(workspaceFile('file-1'))
    mockResolveWorkspaceFileReference.mockResolvedValue(workspaceFile('file-1'))
    mockFetchWorkspaceFileBuffer.mockResolvedValue(Buffer.from('before:'))
    mockUpdateWorkspaceFileContent.mockImplementation(
      async (
        _ws: string,
        fileId: string,
        _user: string,
        _buffer: Buffer,
        _mime: string | undefined,
        options: { secretProvenancePolicy: { provenance: WorkspaceFileSecretProvenance } }
      ) => {
        await replaceWorkspaceFileSecretProvenanceInTx(
          dbChainMock.db as unknown as DbTransaction,
          fileId,
          NEXT_CONTENT_UPDATED_AT,
          options.secretProvenancePolicy.provenance
        )
        return { ...workspaceFile('file-1'), contentUpdatedAt: NEXT_CONTENT_UPDATED_AT }
      }
    )
  })

  it.each([
    { predecessor: 'unrecorded', secret: true, expectedStatus: 'unknown' },
    { predecessor: 'exact', secret: true, expectedStatus: 'exact' },
    { predecessor: 'legacy', secret: true, expectedStatus: 'exact' },
    { predecessor: 'unrecorded', secret: false, expectedStatus: 'unrecorded' },
    { predecessor: 'legacy', secret: false, expectedStatus: 'exact' },
    { predecessor: 'unknown', secret: false, expectedStatus: 'unknown' },
  ] as const)(
    'appends secret=$secret to $predecessor without losing known lineage or changing absence policy',
    async ({ predecessor, secret, expectedStatus }) => {
      queueTableRows(workspaceFiles, [
        {
          ...joinedRow(predecessor),
          secretProvenanceVersion: predecessor === 'legacy' ? null : 1,
        },
      ])
      const content = secret ? SECRET : 'ordinary text'
      const response = await executeAppend(
        createMockRequest(
          'POST',
          {
            operation: 'append',
            workspaceId: 'workspace-1',
            fileName: 'file-1.txt',
            content,
            __privateSecretProvenance: {
              version: 1,
              complete: true,
              selections: [
                {
                  key: 'content',
                  provenance: {
                    version: 1,
                    complete: true,
                    entries: secret
                      ? [{ name: 'TOKEN', encryptedValue: 'synthetic-ciphertext' }]
                      : [],
                    scope: SCOPE,
                  },
                },
              ],
            },
          },
          PRIVATE_SECRET_PROVENANCE_HEADER
        )
      )
      expect(response.status).toBe(200)
      const call = mockUpdateWorkspaceFileContent.mock.calls[0]
      expect(call[3]).toEqual(Buffer.from(`before:${content}`))
      expect(call[5].expectedUpdatedAt).toEqual(CONTENT_UPDATED_AT)
      const persisted = dbChainMockFns.values.mock.calls
        .map(
          ([value]) =>
            value as {
              fileId: string
              status: string
              contentUpdatedAt: Date
              entries: StoredWorkspaceFileSecretProvenanceEntry[]
            }
        )
        .find((value) => value.fileId === 'file-1')
      expect(persisted).toBeDefined()
      if (!persisted) throw new Error('Expected the sidecar writer to store provenance')
      expect(persisted.status).toBe(expectedStatus)
      expect(persisted.contentUpdatedAt).toEqual(NEXT_CONTENT_UPDATED_AT)
      expect(persisted.entries).toHaveLength(expectedStatus === 'exact' && secret ? 1 : 0)
      expect(dbChainMockFns.set).toHaveBeenCalledWith({ secretProvenanceVersion: 1 })
      for (const enforced of [false, true]) {
        mockEnforced.mockReturnValue(enforced)
        queueTableRows(workspaceFiles, [
          joinedRow(persisted.status, persisted.entries, persisted.contentUpdatedAt),
        ])
        const registry = new ResolvedSecretTraceRegistry([], SCOPE)
        const permitted = await importWorkspaceFileSecretProvenanceForModelView({
          workspaceId: 'workspace-1',
          identity: IDENTITY,
          registry,
          view: 'complete',
          value: `before:${content}`,
        })
        expect(permitted).toBe(
          expectedStatus === 'exact' || (expectedStatus === 'unrecorded' && !enforced)
        )
        if (permitted) {
          expect(projectResolvedSecretModelContent(`before:${content}`, registry)).toEqual({
            safe: true,
            value: secret ? 'before:{{TOKEN}}' : `before:${content}`,
          })
        }
        queueTableRows(workspaceFiles, [
          joinedRow(persisted.status, persisted.entries, persisted.contentUpdatedAt),
        ])
        expect(await isOpaqueWorkspaceFileEgressSafe('workspace-1', IDENTITY)).toBe(
          (expectedStatus === 'exact' && !secret) || (expectedStatus === 'unrecorded' && !enforced)
        )
      }
    }
  )
})
