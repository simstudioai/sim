import { type StoredWorkspaceFileSecretProvenanceEntry, workspaceFiles } from '@sim/db/schema'
import {
  auditMock,
  createMockRequest,
  dbChainMock,
  dbChainMockFns,
  queueTableRows,
  resetDbChainMock,
} from '@sim/testing'
import { encryptionMock, encryptionMockFns } from '@sim/testing/mocks/encryption.mock'
import { fileParsersMock, fileParsersMockFns } from '@sim/testing/mocks/file-parsers.mock'
import { fileUtilsServerMock } from '@sim/testing/mocks/file-utils-server.mock'
import { filesAuthorizationMock } from '@sim/testing/mocks/files-authorization.mock'
import { permissionsMock, permissionsMockFns } from '@sim/testing/mocks/permissions.mock'
import { publicSharesMock } from '@sim/testing/mocks/public-shares.mock'
import { realtimeNotifyMock } from '@sim/testing/mocks/realtime-notify.mock'
import { uploadsMetadataMock } from '@sim/testing/mocks/uploads-metadata.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import {
  workspaceFileManagerMock,
  workspaceFileManagerMockFns,
} from '@sim/testing/mocks/workspace-file-manager.mock'
import { workspaceFilesListMock } from '@sim/testing/mocks/workspace-files-list.mock'
import { workspaceUploadsMock } from '@sim/testing/mocks/workspace-uploads.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/uploads/archive', () => ({
  ArchiveError: class ArchiveError extends Error {},
  decompressArchiveBufferToWorkspaceFiles: vi.fn(),
  MAX_ARCHIVE_BYTES: 104_857_600,
  statusForArchiveError: () => 400,
}))

vi.mock('@/lib/file-parsers', () => fileParsersMock)

vi.mock('@sim/audit', () => auditMock)

vi.mock('@/lib/realtime/notify', () => realtimeNotifyMock)

vi.mock('@/lib/public-shares/share-manager', () => publicSharesMock)

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => workspaceFileManagerMock)

vi.mock('@/lib/uploads/contexts/workspace', () => workspaceUploadsMock)

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

vi.mock('@/lib/workspace-files/application/list-workspace-files', () => workspaceFilesListMock)

vi.mock('@/lib/workspace-files/application/move-workspace-file-items', () => ({
  moveWorkspaceFileItemsOperation: {
    execute: vi.fn(),
  },
}))

vi.mock('@/lib/uploads/server/metadata', () => uploadsMetadataMock)

vi.mock('@/lib/uploads/utils/file-utils.server', () => fileUtilsServerMock)

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

vi.mock('@/app/api/files/authorization', () => filesAuthorizationMock)

vi.mock('@/lib/execution/durable-secret-provenance-telemetry', () => ({
  reportDurableSecretProvenanceWrite: vi.fn(),
  reportDurableSecretProvenanceRefusal: vi.fn(),
}))
vi.mock('@/lib/core/security/encryption', () => encryptionMock)

const { mockAssertActiveWorkspaceAccess } = permissionsMockFns
const {
  mockFetchWorkspaceFileBuffer,
  mockGetWorkspaceFile,
  mockLoadActiveWorkspaceContext,
  mockLoadActiveWorkspaceFileContext,
  mockResolveWorkspaceFileReference,
  mockUpdateWorkspaceFileContent,
} = workspaceFileManagerMockFns
const { mockResolveEffectiveWorkspacePermission } = workspaceAuthzMockFns

fileParsersMockFns.mockIsSupportedFileType.mockImplementation(() => false)

encryptionMockFns.mockDecryptSecret.mockImplementation(async () => ({
  decrypted: 'synthetic-known-secret-123',
}))
encryptionMockFns.mockEncryptSecret.mockImplementation(async () => ({
  encrypted: 'synthetic-ciphertext',
}))

import { fileManageBodySchema } from '@/lib/api/contracts/tools/file'
import type { DbTransaction } from '@/lib/db/types'
import {
  executeFileManageOperation,
  getFileContentProvenance,
} from '@/lib/internal/file/operations'
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
    resetDbChainMock()
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
      expect(permitted).toBe(expectedStatus === 'exact')
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
        expectedStatus === 'exact' && !secret
      )
    }
  )
})

describe('execution-file content provenance', () => {
  const identity = {
    fileId: 'execution-file',
    key: 'execution/workspace-1/workflow-1/execution-1/report.txt',
    context: 'execution' as const,
    contentUpdatedAt: CONTENT_UPDATED_AT,
  }
  const principal = createWorkspaceFileDelegatedPrincipal({
    serviceId: 'executor',
    subjectUserId: 'user-1',
    workspaceId: 'workspace-1',
    delegationId: 'test-file-content',
  })

  beforeEach(() => {
    resetDbChainMock()
  })

  it.each([
    { status: 'exact', version: 1, stale: false, complete: true },
    { status: 'unrecorded', version: 1, stale: false, complete: false },
    { status: 'unknown', version: 1, stale: false, complete: false },
    { status: 'unknown', version: null, stale: false, complete: true },
    { status: 'exact', version: 1, stale: true, complete: false },
  ])(
    'reads $status version=$version stale=$stale',
    async ({ status, version, stale, complete }) => {
      queueTableRows(workspaceFiles, [
        {
          ...joinedRow(status),
          secretProvenanceVersion: version,
          ...(stale ? { provenanceContentUpdatedAt: new Date(0) } : {}),
        },
      ])

      const provenance = await getFileContentProvenance(principal, 'workspace-1', [
        { identity, ownerUserId: 'user-1' },
      ])

      expect(provenance).toMatchObject({ version: 1, complete, entries: [] })
    }
  )

  it('retains exact secret-bearing execution lineage for downstream text projections', async () => {
    queueTableRows(workspaceFiles, [
      joinedRow('exact', [
        {
          name: 'TOKEN',
          encryptedValue: 'synthetic-ciphertext',
          sourceUserId: 'user-1',
          sourceWorkspaceId: 'workspace-1',
        },
      ]),
    ])

    const provenance = await getFileContentProvenance(principal, 'workspace-1', [
      { identity, ownerUserId: 'user-1' },
    ])
    const registry = new ResolvedSecretTraceRegistry([], SCOPE)
    expect(provenance.complete).toBe(true)
    expect(await registry.importProvenance(provenance, { trusted: true })).toBe(true)
    expect(projectResolvedSecretModelContent(`parsed: ${SECRET}`, registry)).toEqual({
      safe: true,
      value: 'parsed: {{TOKEN}}',
    })
  })

  it.each([
    { sourceUserId: 'other-user', sourceWorkspaceId: 'workspace-1' },
    { sourceUserId: 'user-1', sourceWorkspaceId: 'other-workspace' },
  ])('anonymizes names from a different source scope: %j', async (sourceScope) => {
    queueTableRows(workspaceFiles, [
      joinedRow('exact', [
        { name: 'PRIVATE_SOURCE_NAME', encryptedValue: 'synthetic-ciphertext', ...sourceScope },
      ]),
    ])

    const provenance = await getFileContentProvenance(principal, 'workspace-1', [
      { identity, ownerUserId: 'user-1' },
    ])

    expect(provenance).toEqual({
      version: 1,
      complete: true,
      entries: [{ encryptedValue: 'synthetic-ciphertext' }],
      scope: SCOPE,
    })
    expect(JSON.stringify(provenance)).not.toContain('PRIVATE_SOURCE_NAME')
  })
})
