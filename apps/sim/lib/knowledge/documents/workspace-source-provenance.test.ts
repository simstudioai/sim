/**
 * @vitest-environment node
 */
import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceFileSecretProvenance } from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'

const {
  mockCheckStorageQuotaForBillingContext,
  mockDeleteFile,
  mockDeleteFileMetadataByIdentity,
  mockGetBoundWorkspaceFileSecretProvenanceByMetadata,
  mockGetFileMetadataByKeys,
  mockIncrementStorageUsageForBillingContextInTx,
  mockMaybeNotifyStorageLimitForBillingContext,
  mockResolveStorageBillingContext,
} = vi.hoisted(() => ({
  mockCheckStorageQuotaForBillingContext: vi.fn(),
  mockDeleteFile: vi.fn(),
  mockDeleteFileMetadataByIdentity: vi.fn(),
  mockGetBoundWorkspaceFileSecretProvenanceByMetadata: vi.fn(),
  mockGetFileMetadataByKeys: vi.fn(),
  mockIncrementStorageUsageForBillingContextInTx: vi.fn(),
  mockMaybeNotifyStorageLimitForBillingContext: vi.fn(),
  mockResolveStorageBillingContext: vi.fn(),
}))

vi.mock('@/lib/billing/storage', () => ({
  applyStorageUsageDeltasInTx: vi.fn(),
  checkStorageQuota: vi.fn(),
  checkStorageQuotaForBillingContext: mockCheckStorageQuotaForBillingContext,
  incrementStorageUsageForBillingContextInTx: mockIncrementStorageUsageForBillingContextInTx,
  maybeNotifyStorageLimitForBillingContext: mockMaybeNotifyStorageLimitForBillingContext,
  resolveStorageBillingContext: mockResolveStorageBillingContext,
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-secret-provenance', () => ({
  getBoundWorkspaceFileSecretProvenanceByMetadata:
    mockGetBoundWorkspaceFileSecretProvenanceByMetadata,
}))

vi.mock('@/lib/uploads/core/storage-service', () => ({
  deleteFile: mockDeleteFile,
}))

vi.mock('@/lib/uploads/server/metadata', () => ({
  deleteFileMetadataByIdentity: mockDeleteFileMetadataByIdentity,
  getFileMetadataByKeys: mockGetFileMetadataByKeys,
}))

import {
  createDocumentRecords,
  createSingleDocument,
  deleteDocumentStorageFiles,
} from '@/lib/knowledge/documents/service'

const WORKSPACE_ID = 'workspace-1'
const KNOWLEDGE_BASE_ID = 'knowledge-base-1'
const KNOWLEDGE_BASE_OWNER_ID = 'knowledge-owner'
const SOURCE_USER_ID = 'source-user'
const SOURCE_KEY = `workspace/${WORKSPACE_ID}/source.pdf`
const SOURCE_URL = `/api/files/serve/${encodeURIComponent(SOURCE_KEY)}?context=workspace`
const CONTENT_UPDATED_AT = new Date('2026-08-05T12:00:00.000Z')

const SOURCE_BINDING = {
  id: 'source-file-1',
  key: SOURCE_KEY,
  userId: SOURCE_USER_ID,
  workspaceId: WORKSPACE_ID,
  context: 'workspace',
  originalName: 'source.pdf',
  displayName: 'source.pdf',
  contentType: 'application/pdf',
  size: 512,
  folderId: null,
  uploadedAt: CONTENT_UPDATED_AT,
  contentUpdatedAt: CONTENT_UPDATED_AT,
  deletedAt: null,
  secretProvenanceVersion: 1,
}

const STORAGE_CONTEXT = {
  workspaceId: WORKSPACE_ID,
  billedAccountUserId: KNOWLEDGE_BASE_OWNER_ID,
  billingEntity: { type: 'organization' as const, id: 'workspace-org' },
  plan: 'team_25000',
  customStorageLimitGB: null,
}

function mockWorkspaceSourceBinding(context: string) {
  return context === 'workspace' ? [SOURCE_BINDING] : []
}

function findDocumentProvenanceWrite() {
  return dbChainMockFns.values.mock.calls
    .map(([value]) => value)
    .find((value) => !Array.isArray(value) && value?.documentId)
}

describe('knowledge workspace source provenance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    dbChainMockFns.limit.mockResolvedValue([
      {
        id: KNOWLEDGE_BASE_ID,
        workspaceId: WORKSPACE_ID,
        userId: KNOWLEDGE_BASE_OWNER_ID,
      },
    ])
    mockResolveStorageBillingContext.mockResolvedValue(STORAGE_CONTEXT)
    mockCheckStorageQuotaForBillingContext.mockResolvedValue({ allowed: true })
    mockIncrementStorageUsageForBillingContextInTx.mockResolvedValue(512)
    mockMaybeNotifyStorageLimitForBillingContext.mockResolvedValue(undefined)
    mockGetFileMetadataByKeys.mockImplementation(async (_keys: string[], context: string) =>
      mockWorkspaceSourceBinding(context)
    )
    mockGetBoundWorkspaceFileSecretProvenanceByMetadata.mockResolvedValue(
      new Map([
        [
          SOURCE_BINDING.id,
          {
            status: 'exact',
            entries: [{ name: 'OCR_SECRET', encryptedValue: 'encrypted-secret' }],
          },
        ],
      ])
    )
  })

  it('merges a tracked workspace source into a single document sidecar', async () => {
    await createSingleDocument(
      {
        filename: 'source.pdf',
        fileUrl: SOURCE_URL,
        fileSize: 512,
        mimeType: 'application/pdf',
      },
      KNOWLEDGE_BASE_ID,
      'request-1',
      SOURCE_USER_ID
    )

    expect(mockGetFileMetadataByKeys).toHaveBeenCalledWith(
      [SOURCE_KEY],
      'workspace',
      expect.anything()
    )
    expect(mockGetFileMetadataByKeys).toHaveBeenCalledWith(
      [SOURCE_KEY],
      'mothership',
      expect.anything()
    )
    expect(mockGetBoundWorkspaceFileSecretProvenanceByMetadata).toHaveBeenCalledWith(
      expect.anything(),
      [SOURCE_BINDING]
    )
    expect(findDocumentProvenanceWrite()).toEqual(
      expect.objectContaining({
        status: 'exact',
        entries: [
          expect.objectContaining({
            name: 'OCR_SECRET',
            encryptedValue: 'encrypted-secret',
            sourceUserId: SOURCE_USER_ID,
            sourceWorkspaceId: WORKSPACE_ID,
            sourceValueHash: expect.any(String),
          }),
        ],
      })
    )
  })

  it('uses the same workspace source provenance path for bulk document creation', async () => {
    await createDocumentRecords(
      [
        {
          filename: 'source.pdf',
          fileUrl: SOURCE_URL,
          fileSize: 512,
          mimeType: 'application/pdf',
        },
      ],
      KNOWLEDGE_BASE_ID,
      'request-1',
      SOURCE_USER_ID
    )

    expect(findDocumentProvenanceWrite()).toEqual(
      expect.objectContaining({
        status: 'exact',
        entries: [expect.objectContaining({ name: 'OCR_SECRET' })],
      })
    )
  })

  it('preserves a tracked exact-empty manual upload as model-safe', async () => {
    mockGetBoundWorkspaceFileSecretProvenanceByMetadata.mockResolvedValue(
      new Map([[SOURCE_BINDING.id, { status: 'exact', entries: [] }]])
    )

    await createSingleDocument(
      {
        filename: 'source.pdf',
        fileUrl: SOURCE_URL,
        fileSize: 512,
        mimeType: 'application/pdf',
      },
      KNOWLEDGE_BASE_ID,
      'request-1',
      SOURCE_USER_ID
    )

    expect(findDocumentProvenanceWrite()).toEqual(
      expect.objectContaining({ status: 'exact', entries: [] })
    )
  })

  it('uses the trusted mothership row context instead of the URL context label', async () => {
    const mothershipBinding = {
      ...SOURCE_BINDING,
      id: 'mothership-file-1',
      context: 'mothership',
    }
    mockGetFileMetadataByKeys.mockImplementation(async (_keys: string[], context: string) =>
      context === 'mothership' ? [mothershipBinding] : []
    )
    mockGetBoundWorkspaceFileSecretProvenanceByMetadata.mockResolvedValue(
      new Map([
        [
          mothershipBinding.id,
          {
            status: 'exact',
            entries: [{ name: 'CHAT_SECRET', encryptedValue: 'encrypted-chat-secret' }],
          },
        ],
      ])
    )

    await createSingleDocument(
      {
        filename: 'source.pdf',
        fileUrl: SOURCE_URL,
        fileSize: 512,
        mimeType: 'application/pdf',
      },
      KNOWLEDGE_BASE_ID,
      'request-1',
      SOURCE_USER_ID
    )

    expect(mockGetBoundWorkspaceFileSecretProvenanceByMetadata).toHaveBeenCalledWith(
      expect.anything(),
      [mothershipBinding]
    )
    expect(findDocumentProvenanceWrite()).toEqual(
      expect.objectContaining({
        status: 'exact',
        entries: [expect.objectContaining({ name: 'CHAT_SECRET' })],
      })
    )
  })

  it('preserves legacy behavior when a workspace source has no metadata binding', async () => {
    mockGetFileMetadataByKeys.mockResolvedValue([])

    await createSingleDocument(
      {
        filename: 'legacy.pdf',
        fileUrl: SOURCE_URL,
        fileSize: 512,
        mimeType: 'application/pdf',
      },
      KNOWLEDGE_BASE_ID,
      'request-1',
      SOURCE_USER_ID
    )

    expect(mockGetBoundWorkspaceFileSecretProvenanceByMetadata).toHaveBeenCalledWith(
      expect.anything(),
      []
    )
    expect(findDocumentProvenanceWrite()).toBeUndefined()
  })

  describe('execution file sources', () => {
    const executionKey = `execution/${WORKSPACE_ID}/workflow-1/run-1/source.pdf`
    const executionUrl = `/api/files/serve/${encodeURIComponent(executionKey)}?context=workspace`
    const executionBinding = {
      ...SOURCE_BINDING,
      id: 'execution-source-1',
      key: executionKey,
      context: 'execution',
    }
    const documentInput = {
      filename: 'source.pdf',
      fileUrl: executionUrl,
      fileSize: 512,
      mimeType: 'application/pdf',
    }

    beforeEach(() => {
      mockGetFileMetadataByKeys.mockImplementation(async (_keys: string[], context: string) =>
        context === 'execution' ? [executionBinding] : []
      )
    })

    for (const mode of ['single', 'bulk'] as const) {
      async function create() {
        if (mode === 'single') {
          await createSingleDocument(documentInput, KNOWLEDGE_BASE_ID, 'request-1', SOURCE_USER_ID)
        } else {
          await createDocumentRecords(
            [documentInput],
            KNOWLEDGE_BASE_ID,
            'request-1',
            SOURCE_USER_ID
          )
        }
      }

      it.each([
        { status: 'exact', entries: [] },
        {
          status: 'exact',
          entries: [{ name: 'EXPORT_SECRET', encryptedValue: 'encrypted-export-secret' }],
        },
        { status: 'unknown' },
      ] satisfies WorkspaceFileSecretProvenance[])(
        `binds canonical execution byte provenance during ${mode} admission: %j`,
        async (provenance) => {
          mockGetBoundWorkspaceFileSecretProvenanceByMetadata.mockResolvedValue(
            new Map([[executionBinding.id, provenance]])
          )

          await create()

          expect(mockGetFileMetadataByKeys).toHaveBeenCalledWith(
            [executionKey],
            'execution',
            expect.anything(),
            { includeDeleted: true }
          )
          expect(mockGetBoundWorkspaceFileSecretProvenanceByMetadata).toHaveBeenCalledWith(
            expect.anything(),
            [executionBinding]
          )
          expect(findDocumentProvenanceWrite()).toEqual(
            expect.objectContaining({
              status: provenance.status,
              entries:
                provenance.status === 'exact'
                  ? provenance.entries.map((entry) =>
                      expect.objectContaining({
                        ...entry,
                        sourceUserId: SOURCE_USER_ID,
                        sourceWorkspaceId: WORKSPACE_ID,
                        sourceValueHash: expect.any(String),
                      })
                    )
                  : [],
            })
          )
        }
      )

      it(`preserves soft-deleted execution taint during ${mode} admission`, async () => {
        const deletedBinding = { ...executionBinding, deletedAt: CONTENT_UPDATED_AT }
        mockGetFileMetadataByKeys.mockImplementation(
          async (
            _keys: string[],
            context: string,
            _executor: unknown,
            options?: { includeDeleted?: boolean }
          ) => (context === 'execution' && options?.includeDeleted ? [deletedBinding] : [])
        )
        mockGetBoundWorkspaceFileSecretProvenanceByMetadata.mockResolvedValue(
          new Map([[executionBinding.id, { status: 'unknown' }]])
        )

        await create()

        expect(findDocumentProvenanceWrite()).toMatchObject({ status: 'unknown', entries: [] })
      })

      it.each(['missing', 'untracked'])(
        `preserves legacy %s execution sources during ${mode} admission`,
        async (kind) => {
          mockGetFileMetadataByKeys.mockResolvedValue(
            kind === 'missing' ? [] : [{ ...executionBinding, secretProvenanceVersion: null }]
          )

          await create()

          expect(mockGetBoundWorkspaceFileSecretProvenanceByMetadata).toHaveBeenCalledWith(
            expect.anything(),
            []
          )
          expect(findDocumentProvenanceWrite()).toBeUndefined()
        }
      )

      it(`refuses another workspace's execution source before ${mode} admission`, async () => {
        mockGetFileMetadataByKeys.mockResolvedValue([
          { ...executionBinding, workspaceId: 'other-workspace' },
        ])

        await expect(create()).rejects.toThrow('Document file is not owned by this knowledge base')

        expect(mockGetBoundWorkspaceFileSecretProvenanceByMetadata).not.toHaveBeenCalled()
        expect(findDocumentProvenanceWrite()).toBeUndefined()
        expect(mockIncrementStorageUsageForBillingContextInTx).not.toHaveBeenCalled()
      })
    }
  })

  it('never deletes a referenced workspace source as knowledge-base storage', async () => {
    await deleteDocumentStorageFiles(
      [{ id: 'document-1', fileUrl: SOURCE_URL, workspaceId: WORKSPACE_ID }],
      'request-1'
    )

    expect(mockGetFileMetadataByKeys).not.toHaveBeenCalled()
    expect(mockDeleteFile).not.toHaveBeenCalled()
    expect(mockDeleteFileMetadataByIdentity).not.toHaveBeenCalled()
  })

  it.each(['kb', 'knowledge-base'])(
    'queues a trusted %s object with its exact metadata identity',
    async (keyPrefix) => {
      const storageKey = `${keyPrefix}/owned.pdf`
      const fileUrl = `/api/files/serve/${encodeURIComponent(storageKey)}?context=knowledge-base`
      const binding = {
        ...SOURCE_BINDING,
        id: `binding-${keyPrefix}`,
        key: storageKey,
        context: 'knowledge-base',
      }
      mockGetFileMetadataByKeys.mockResolvedValue([binding])
      await deleteDocumentStorageFiles(
        [{ id: 'document-1', fileUrl, workspaceId: WORKSPACE_ID }],
        'request-1'
      )
      expect(dbChainMockFns.values).toHaveBeenCalledWith([
        expect.objectContaining({
          eventType: 'knowledge.document.storage.cleanup',
          payload: expect.objectContaining({
            fileId: binding.id,
            key: storageKey,
            contentUpdatedAt: CONTENT_UPDATED_AT.toISOString(),
          }),
        }),
      ])
      expect(mockDeleteFile).not.toHaveBeenCalled()
      expect(mockDeleteFileMetadataByIdentity).not.toHaveBeenCalled()
    }
  )

  it.each(['org-1', 'org-2', null])(
    'only queues an organization cache for its exact owner: %s',
    async (organizationId) => {
      const storageKey = 'kb/org-source.pdf'
      mockGetFileMetadataByKeys.mockResolvedValue([
        {
          ...SOURCE_BINDING,
          key: storageKey,
          context: 'knowledge-base',
          workspaceId: null,
          organizationId: 'org-1',
        },
      ])
      const cleanup = deleteDocumentStorageFiles(
        [
          {
            id: 'org-doc',
            fileUrl: `/api/files/serve/${encodeURIComponent(storageKey)}`,
            workspaceId: null,
            organizationId,
          },
        ],
        'request-1'
      )
      if (organizationId === 'org-1') {
        await expect(cleanup).resolves.toBeUndefined()
        expect(dbChainMockFns.values).toHaveBeenCalledOnce()
      } else {
        await expect(cleanup).rejects.toThrow()
        expect(dbChainMockFns.values).not.toHaveBeenCalled()
      }
      expect(mockDeleteFile).not.toHaveBeenCalled()
    }
  )
})
