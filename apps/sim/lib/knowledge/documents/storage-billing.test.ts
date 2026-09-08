/**
 * @vitest-environment node
 */
import {
  dbChainMock,
  dbChainMockFns,
  flattenMockConditions,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockApplyStorageUsageDeltasInTx,
  mockCheckStorageQuota,
  mockCheckStorageQuotaForBillingContext,
  mockDecrementStorageUsageForBillingContextInTx,
  mockIncrementStorageUsageForBillingContextInTx,
  mockMaybeNotifyStorageLimitForBillingContext,
  mockResolveStorageBillingContext,
  mockGetFileMetadataByKeys,
  mockEnqueueKnowledgeDocumentProcessing,
} = vi.hoisted(() => ({
  mockApplyStorageUsageDeltasInTx: vi.fn(),
  mockCheckStorageQuota: vi.fn(),
  mockCheckStorageQuotaForBillingContext: vi.fn(),
  mockDecrementStorageUsageForBillingContextInTx: vi.fn(),
  mockIncrementStorageUsageForBillingContextInTx: vi.fn(),
  mockMaybeNotifyStorageLimitForBillingContext: vi.fn(),
  mockResolveStorageBillingContext: vi.fn(),
  mockGetFileMetadataByKeys: vi.fn(),
  mockEnqueueKnowledgeDocumentProcessing: vi.fn(),
}))

vi.mock('@/lib/billing/storage', () => ({
  applyStorageUsageDeltasInTx: mockApplyStorageUsageDeltasInTx,
  checkStorageQuota: mockCheckStorageQuota,
  checkStorageQuotaForBillingContext: mockCheckStorageQuotaForBillingContext,
  decrementStorageUsageForBillingContextInTx: mockDecrementStorageUsageForBillingContextInTx,
  incrementStorageUsageForBillingContextInTx: mockIncrementStorageUsageForBillingContextInTx,
  maybeNotifyStorageLimitForBillingContext: mockMaybeNotifyStorageLimitForBillingContext,
  resolveStorageBillingContext: mockResolveStorageBillingContext,
}))

vi.mock('@/lib/uploads/server/metadata', () => ({
  deleteFileMetadata: vi.fn(),
  getFileMetadataByKeys: mockGetFileMetadataByKeys,
}))

vi.mock('@/lib/knowledge/documents/processing-outbox-event', () => ({
  enqueueKnowledgeDocumentProcessing: mockEnqueueKnowledgeDocumentProcessing,
}))

import {
  ConnectorSyncDeletionGuardError,
  createDocumentRecords,
  createSingleDocument,
  hardDeleteDocuments,
} from '@/lib/knowledge/documents/service'

const STORAGE_CONTEXT = {
  workspaceId: 'workspace-1',
  billedAccountUserId: 'workspace-owner',
  billingEntity: { type: 'organization' as const, id: 'workspace-org' },
  plan: 'team_25000',
  customStorageLimitGB: null,
}

describe('knowledge document storage attribution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    dbChainMockFns.limit.mockResolvedValue([
      {
        id: 'knowledge-base-1',
        workspaceId: 'workspace-1',
        userId: 'knowledge-owner',
      },
    ])
    mockResolveStorageBillingContext.mockResolvedValue(STORAGE_CONTEXT)
    mockCheckStorageQuotaForBillingContext.mockResolvedValue({ allowed: true })
    mockIncrementStorageUsageForBillingContextInTx.mockResolvedValue(5)
    mockApplyStorageUsageDeltasInTx.mockResolvedValue(undefined)
    mockMaybeNotifyStorageLimitForBillingContext.mockResolvedValue(undefined)
    mockGetFileMetadataByKeys.mockResolvedValue([])
    mockEnqueueKnowledgeDocumentProcessing.mockResolvedValue('outbox-1')
  })

  it.each(['external-collaborator', 'personal-api-key-user'])(
    'charges workspace storage while retaining %s as uploader identity',
    async (actorUserId) => {
      await createDocumentRecords(
        [
          {
            filename: 'note.txt',
            fileUrl: 'data:text/plain;base64,SGVsbG8=',
            fileSize: 5,
            mimeType: 'text/plain',
          },
        ],
        'knowledge-base-1',
        'request-1',
        actorUserId
      )

      expect(mockResolveStorageBillingContext).toHaveBeenCalledWith('workspace-1')
      expect(mockCheckStorageQuotaForBillingContext).toHaveBeenCalledWith(STORAGE_CONTEXT, 5)
      expect(mockIncrementStorageUsageForBillingContextInTx).toHaveBeenCalledWith(
        expect.anything(),
        STORAGE_CONTEXT,
        5
      )
      expect(mockMaybeNotifyStorageLimitForBillingContext).toHaveBeenCalledWith(STORAGE_CONTEXT, 5)
      expect(mockCheckStorageQuota).not.toHaveBeenCalled()
      expect(dbChainMockFns.values).toHaveBeenCalledWith([
        expect.objectContaining({ uploadedBy: actorUserId }),
      ])
    }
  )

  it('notifies the workspace payer after a single document transaction commits', async () => {
    let transactionCommitted = false
    dbChainMockFns.transaction.mockImplementationOnce(
      async (callback: (tx: typeof dbChainMock.db) => unknown) => {
        const result = await callback(dbChainMock.db)
        transactionCommitted = true
        return result
      }
    )
    mockMaybeNotifyStorageLimitForBillingContext.mockImplementationOnce(() => {
      expect(transactionCommitted).toBe(true)
    })

    await createSingleDocument(
      {
        filename: 'note.txt',
        fileUrl: 'data:text/plain;base64,SGVsbG8=',
        fileSize: 5,
        mimeType: 'text/plain',
      },
      'knowledge-base-1',
      'request-1',
      'external-collaborator'
    )

    expect(mockIncrementStorageUsageForBillingContextInTx).toHaveBeenCalledWith(
      expect.anything(),
      STORAGE_CONTEXT,
      5
    )
    expect(mockMaybeNotifyStorageLimitForBillingContext).toHaveBeenCalledWith(STORAGE_CONTEXT, 5)
  })

  it('returns the pending processing state persisted for a new document', async () => {
    const created = await createSingleDocument(
      {
        filename: 'note.txt',
        fileUrl: 'data:text/plain;base64,SGVsbG8=',
        fileSize: 5,
        mimeType: 'text/plain',
      },
      'knowledge-base-1',
      'request-1',
      'external-collaborator'
    )

    expect(created.processingStatus).toBe('pending')
    expect(dbChainMockFns.values).toHaveBeenCalledWith(
      expect.objectContaining({ processingStatus: 'pending' })
    )
  })

  it('resolves admission before opening the document transaction', async () => {
    let transactionOpen = false
    mockResolveStorageBillingContext.mockImplementationOnce(async () => {
      expect(transactionOpen).toBe(false)
      return STORAGE_CONTEXT
    })
    dbChainMockFns.transaction.mockImplementationOnce(
      async (callback: (tx: typeof dbChainMock.db) => unknown) => {
        transactionOpen = true
        try {
          return await callback(dbChainMock.db)
        } finally {
          transactionOpen = false
        }
      }
    )

    await createSingleDocument(
      {
        filename: 'note.txt',
        fileUrl: 'data:text/plain;base64,SGVsbG8=',
        fileSize: 5,
        mimeType: 'text/plain',
      },
      'knowledge-base-1',
      'request-1',
      'external-collaborator'
    )
  })

  it('enqueues processing inside the document storage transaction', async () => {
    const billingAttribution = {
      actorUserId: 'external-collaborator',
      workspaceId: 'workspace-1',
      organizationId: null,
      billedAccountUserId: 'workspace-owner',
      billingEntity: { type: 'user' as const, id: 'workspace-owner' },
      billingPeriod: {
        start: '2026-08-01T00:00:00.000Z',
        end: '2026-09-01T00:00:00.000Z',
      },
      payerSubscription: null,
    }

    await createSingleDocument(
      {
        filename: 'note.txt',
        fileUrl: 'data:text/plain;base64,SGVsbG8=',
        fileSize: 5,
        mimeType: 'text/plain',
      },
      'knowledge-base-1',
      'request-1',
      'external-collaborator',
      'document-1',
      undefined,
      {
        expectedWorkspaceId: 'workspace-1',
        processing: { processingOptions: { lang: 'en' }, billingAttribution },
      }
    )

    expect(mockEnqueueKnowledgeDocumentProcessing).toHaveBeenCalledWith(dbChainMock.db, {
      knowledgeBaseId: 'knowledge-base-1',
      documentId: 'document-1',
      processingOptions: { lang: 'en' },
      billingAttribution,
    })
  })

  it('rolls back document creation when durable processing enqueue fails', async () => {
    const failure = new Error('outbox unavailable')
    mockEnqueueKnowledgeDocumentProcessing.mockRejectedValueOnce(failure)

    await expect(
      createSingleDocument(
        {
          filename: 'note.txt',
          fileUrl: 'data:text/plain;base64,SGVsbG8=',
          fileSize: 5,
          mimeType: 'text/plain',
        },
        'knowledge-base-1',
        'request-1',
        'external-collaborator',
        'document-1',
        undefined,
        {
          expectedWorkspaceId: 'workspace-1',
          processing: {
            processingOptions: {},
            billingAttribution: {
              actorUserId: 'external-collaborator',
              workspaceId: 'workspace-1',
              organizationId: null,
              billedAccountUserId: 'workspace-owner',
              billingEntity: { type: 'user', id: 'workspace-owner' },
              billingPeriod: {
                start: '2026-08-01T00:00:00.000Z',
                end: '2026-09-01T00:00:00.000Z',
              },
              payerSubscription: null,
            },
          },
        }
      )
    ).rejects.toBe(failure)

    expect(mockMaybeNotifyStorageLimitForBillingContext).not.toHaveBeenCalled()
  })

  it.each(['kb', 'knowledge-base'])(
    'uses server-known %s file metadata size for quota, ledger, and document row',
    async (keyPrefix) => {
      const storageKey = `${keyPrefix}/verified-file`
      const fileUrl = `/api/files/serve/${encodeURIComponent(storageKey)}?context=knowledge-base`
      mockGetFileMetadataByKeys.mockResolvedValue([
        {
          key: storageKey,
          workspaceId: 'workspace-1',
          userId: 'external-collaborator',
          sizeBytes: 8,
        },
      ])
      mockIncrementStorageUsageForBillingContextInTx.mockResolvedValue(13)

      const result = await createSingleDocument(
        {
          filename: 'note.txt',
          fileUrl,
          fileSize: 5,
          mimeType: 'text/plain',
        },
        'knowledge-base-1',
        'request-1',
        'external-collaborator'
      )

      expect(mockCheckStorageQuotaForBillingContext).toHaveBeenCalledWith(STORAGE_CONTEXT, 8)
      expect(mockIncrementStorageUsageForBillingContextInTx).toHaveBeenCalledWith(
        expect.anything(),
        STORAGE_CONTEXT,
        8
      )
      expect(result.fileSize).toBe(8)
      expect(dbChainMockFns.values).toHaveBeenCalledWith(expect.objectContaining({ fileSize: 8 }))
    }
  )

  it('decrements only exact bytes for document rows actually deleted', async () => {
    dbChainMockFns.where.mockResolvedValueOnce([
      {
        id: 'doc-1',
        knowledgeBaseId: 'knowledge-base-1',
        fileUrl: 'data:text/plain;base64,QQ==',
        fileSize: 100,
        uploadedBy: 'external-collaborator',
        connectorId: null,
        workspaceId: 'workspace-1',
        kbUserId: 'knowledge-owner',
      },
      {
        id: 'doc-2',
        knowledgeBaseId: 'knowledge-base-1',
        fileUrl: 'data:text/plain;base64,Qg==',
        fileSize: 200,
        uploadedBy: 'external-collaborator',
        connectorId: null,
        workspaceId: 'workspace-1',
        kbUserId: 'knowledge-owner',
      },
    ])
    dbChainMockFns.for.mockResolvedValueOnce([
      { id: 'knowledge-base-1', workspaceId: 'workspace-1', userId: 'knowledge-owner' },
    ])
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'doc-1' }])

    const deletedCount = await hardDeleteDocuments(['doc-1', 'doc-2'], 'request-1')

    expect(deletedCount).toBe(1)
    expect(mockApplyStorageUsageDeltasInTx).toHaveBeenCalledWith(expect.anything(), {
      workspaceDeltas: [{ context: STORAGE_CONTEXT, deltaBytes: -100 }],
      legacyDeltas: [],
    })
  })

  it('excludes connector document bytes from hard-delete accounting', async () => {
    dbChainMockFns.where.mockResolvedValueOnce([
      {
        id: 'connector-doc',
        knowledgeBaseId: 'knowledge-base-1',
        fileUrl: 'data:text/plain;base64,QQ==',
        fileSize: 500,
        uploadedBy: null,
        connectorId: 'connector-1',
        workspaceId: 'workspace-1',
        kbUserId: 'knowledge-owner',
      },
    ])
    dbChainMockFns.for.mockResolvedValueOnce([
      { id: 'knowledge-base-1', workspaceId: 'workspace-1', userId: 'knowledge-owner' },
    ])
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'connector-doc' }])

    const deletedCount = await hardDeleteDocuments(['connector-doc'], 'request-1')

    expect(deletedCount).toBe(1)
    expect(mockResolveStorageBillingContext).not.toHaveBeenCalled()
    expect(mockApplyStorageUsageDeltasInTx).toHaveBeenCalledWith(expect.anything(), {
      workspaceDeltas: [],
      legacyDeltas: [],
    })
    expect(mockDecrementStorageUsageForBillingContextInTx).not.toHaveBeenCalled()
  })

  it('refuses connector reconciliation deletion after the sync lock is lost', async () => {
    dbChainMockFns.where.mockResolvedValueOnce([
      {
        id: 'connector-doc',
        knowledgeBaseId: 'knowledge-base-1',
        fileUrl: 'data:text/plain;base64,QQ==',
        fileSize: 500,
        uploadedBy: null,
        connectorId: 'connector-1',
        workspaceId: 'workspace-1',
        kbUserId: 'knowledge-owner',
      },
    ])
    dbChainMockFns.for
      .mockResolvedValueOnce([
        { id: 'knowledge-base-1', workspaceId: 'workspace-1', userId: 'knowledge-owner' },
      ])
      .mockResolvedValueOnce([])

    await expect(
      hardDeleteDocuments(['connector-doc'], 'request-1', 'connector-1', undefined, {
        connectorId: 'connector-1',
        knowledgeBaseId: 'knowledge-base-1',
        syncLockToken: 'sync-1',
      })
    ).rejects.toBeInstanceOf(ConnectorSyncDeletionGuardError)

    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
  })

  it('makes the connector sync guard self-contained without excluding tombstones', async () => {
    const connectorDocument = {
      id: 'connector-doc',
      knowledgeBaseId: 'knowledge-base-1',
      fileUrl: 'data:text/plain;base64,QQ==',
      fileSize: 500,
      uploadedBy: null,
      connectorId: 'connector-1',
      workspaceId: 'workspace-1',
      kbUserId: 'knowledge-owner',
    }
    queueTableRows(schemaMock.document, [connectorDocument])
    queueTableRows(schemaMock.knowledgeBase, [
      { id: 'knowledge-base-1', workspaceId: 'workspace-1', userId: 'knowledge-owner' },
    ])
    queueTableRows(schemaMock.knowledgeConnector, [{ id: 'connector-1' }])
    queueTableRows(schemaMock.document, [{ id: 'connector-doc' }])
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'connector-doc' }])

    await expect(
      hardDeleteDocuments(['connector-doc'], 'request-1', undefined, undefined, {
        connectorId: 'connector-1',
        knowledgeBaseId: 'knowledge-base-1',
        syncLockToken: 'sync-1',
      })
    ).resolves.toBe(1)

    const conditions = dbChainMockFns.where.mock.calls.flatMap(([condition]) =>
      flattenMockConditions(condition)
    )
    expect(conditions).toContainEqual({
      type: 'eq',
      left: schemaMock.document.connectorId,
      right: 'connector-1',
    })
    expect(conditions).toContainEqual({
      type: 'eq',
      left: schemaMock.document.knowledgeBaseId,
      right: 'knowledge-base-1',
    })
    expect(conditions).toContainEqual({
      type: 'eq',
      left: schemaMock.document.userExcluded,
      right: false,
    })
    expect(conditions).toContainEqual({
      type: 'isNull',
      column: schemaMock.document.archivedAt,
    })
    expect(conditions).toContainEqual({
      type: 'eq',
      left: schemaMock.knowledgeConnector.id,
      right: 'connector-1',
    })
    expect(conditions).toContainEqual({
      type: 'eq',
      left: schemaMock.knowledgeConnector.knowledgeBaseId,
      right: 'knowledge-base-1',
    })
    expect(conditions).toContainEqual({
      type: 'eq',
      left: schemaMock.knowledgeConnector.status,
      right: 'syncing',
    })
    expect(conditions).toContainEqual({
      type: 'eq',
      left: schemaMock.knowledgeConnector.syncLockToken,
      right: 'sync-1',
    })
    expect(conditions).toContainEqual({
      type: 'isNull',
      column: schemaMock.knowledgeConnector.archivedAt,
    })
    expect(conditions).toContainEqual({
      type: 'isNull',
      column: schemaMock.knowledgeConnector.deletedAt,
    })
    expect(conditions).toContainEqual({
      type: 'isNull',
      column: schemaMock.knowledgeBase.deletedAt,
    })
    expect(conditions).not.toContainEqual({
      type: 'isNull',
      column: schemaMock.document.deletedAt,
    })
    expect(dbChainMockFns.for).toHaveBeenCalledTimes(3)
    expect(dbChainMockFns.for).toHaveBeenLastCalledWith('update')
  })

  it('does not delete a document detached from the connector before the locked recheck', async () => {
    const connectorDocument = {
      id: 'connector-doc',
      knowledgeBaseId: 'knowledge-base-1',
      fileUrl: 'data:text/plain;base64,QQ==',
      fileSize: 500,
      uploadedBy: null,
      connectorId: 'connector-1',
      workspaceId: 'workspace-1',
      kbUserId: 'knowledge-owner',
    }
    queueTableRows(schemaMock.document, [connectorDocument])
    queueTableRows(schemaMock.knowledgeBase, [
      { id: 'knowledge-base-1', workspaceId: 'workspace-1', userId: 'knowledge-owner' },
    ])
    queueTableRows(schemaMock.knowledgeConnector, [{ id: 'connector-1' }])
    queueTableRows(schemaMock.document, [])
    dbChainMockFns.returning.mockResolvedValueOnce([])

    await expect(
      hardDeleteDocuments(['connector-doc'], 'request-1', undefined, undefined, {
        connectorId: 'connector-1',
        knowledgeBaseId: 'knowledge-base-1',
        syncLockToken: 'sync-1',
      })
    ).resolves.toBe(0)

    expect(mockApplyStorageUsageDeltasInTx).toHaveBeenCalledWith(expect.anything(), {
      workspaceDeltas: [],
      legacyDeltas: [],
    })
  })

  it('splits hard deletion into bounded 250-document transactions', async () => {
    const documentIds = Array.from({ length: 251 }, (_, index) => `doc-${index}`)

    await expect(hardDeleteDocuments(documentIds, 'request-1')).resolves.toBe(0)

    expect(dbChainMockFns.select).toHaveBeenCalledTimes(2)
    expect(dbChainMockFns.transaction).not.toHaveBeenCalled()
  })
})

describe('organization document storage deletion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockGetFileMetadataByKeys.mockResolvedValue([])
    mockApplyStorageUsageDeltasInTx.mockResolvedValue(undefined)
  })

  it.each(['connector-1', null])(
    'never decrements personal storage for an organization document (connector: %s)',
    async (connectorId) => {
      queueTableRows(schemaMock.document, [
        {
          id: 'org-doc',
          knowledgeBaseId: 'org-kb',
          fileUrl: null,
          fileSize: 100,
          uploadedBy: 'creator',
          connectorId,
          workspaceId: null,
          organizationId: 'org-1',
          kbUserId: 'creator',
        },
      ])
      queueTableRows(schemaMock.knowledgeBase, [
        { id: 'org-kb', workspaceId: null, organizationId: 'org-1', userId: 'creator' },
      ])
      dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'org-doc' }])
      await expect(hardDeleteDocuments(['org-doc'], 'request-1')).resolves.toBe(1)
      expect(mockResolveStorageBillingContext).not.toHaveBeenCalled()
      expect(mockApplyStorageUsageDeltasInTx).toHaveBeenCalledWith(expect.anything(), {
        workspaceDeltas: [],
        legacyDeltas: [],
      })
    }
  )

  it('refuses a document deletion after its canonical organization changes', async () => {
    queueTableRows(schemaMock.document, [
      {
        id: 'org-doc',
        knowledgeBaseId: 'org-kb',
        fileUrl: null,
        fileSize: 100,
        uploadedBy: 'creator',
        connectorId: 'connector-1',
        workspaceId: null,
        organizationId: 'org-1',
        kbUserId: 'creator',
      },
    ])
    queueTableRows(schemaMock.knowledgeBase, [
      { id: 'org-kb', workspaceId: null, organizationId: 'org-2', userId: 'creator' },
    ])
    await expect(hardDeleteDocuments(['org-doc'], 'request-1')).rejects.toThrow(
      'storage ownership changed'
    )
    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
  })
})
