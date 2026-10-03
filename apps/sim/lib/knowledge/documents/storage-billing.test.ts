import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { billingStorageMock, billingStorageMockFns } from '@sim/testing/mocks/billing-storage.mock'
import {
  uploadsMetadataMock,
  uploadsMetadataMockFns,
} from '@sim/testing/mocks/uploads-metadata.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockEnqueueKnowledgeDocumentProcessing } = vi.hoisted(() => ({
  mockEnqueueKnowledgeDocumentProcessing: vi.fn(),
}))

vi.mock('@/lib/billing/storage', () => billingStorageMock)

vi.mock('@/lib/uploads/server/metadata', () => uploadsMetadataMock)

vi.mock('@/lib/knowledge/documents/processing-outbox-event', () => ({
  enqueueKnowledgeDocumentProcessing: mockEnqueueKnowledgeDocumentProcessing,
}))

import {
  ConnectorSyncDeletionGuardError,
  createDocumentRecords,
  createSingleDocument,
  hardDeleteDocuments,
} from '@/lib/knowledge/documents/service'

const mockGetFileMetadataByKeys = uploadsMetadataMockFns.mockGetFileMetadataByKeys
const mockApplyStorageUsageDeltasInTx = billingStorageMockFns.mockApplyStorageUsageDeltasInTx
const mockCheckStorageQuota = billingStorageMockFns.mockCheckStorageQuota
const mockCheckStorageQuotaForBillingContext =
  billingStorageMockFns.mockCheckStorageQuotaForBillingContext
const mockDecrementStorageUsageForBillingContextInTx =
  billingStorageMockFns.mockDecrementStorageUsageForBillingContextInTx
const mockIncrementStorageUsageForBillingContextInTx =
  billingStorageMockFns.mockIncrementStorageUsageForBillingContextInTx
const mockMaybeNotifyStorageLimitForBillingContext =
  billingStorageMockFns.mockMaybeNotifyStorageLimitForBillingContext
const mockResolveStorageBillingContext = billingStorageMockFns.mockResolveStorageBillingContext

const STORAGE_CONTEXT = {
  workspaceId: 'workspace-1',
  billedAccountUserId: 'workspace-owner',
  billingEntity: { type: 'organization' as const, id: 'workspace-org' },
  plan: 'team_25000',
  customStorageLimitGB: null,
}

describe('knowledge document storage attribution', () => {
  beforeEach(() => {
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
    dbChainMockFns.returning.mockResolvedValueOnce([
      {
        id: 'doc-1',
        knowledgeBaseId: 'knowledge-base-1',
        fileUrl: 'data:text/plain;base64,QQ==',
        fileSize: 100,
        uploadedBy: 'external-collaborator',
        connectorId: null,
      },
    ])

    const deletedCount = await hardDeleteDocuments(['doc-1', 'doc-2'], 'request-1')

    expect(deletedCount).toBe(1)
    expect(mockApplyStorageUsageDeltasInTx).toHaveBeenCalledWith(expect.anything(), {
      workspaceDeltas: [{ context: STORAGE_CONTEXT, deltaBytes: -100 }],
      legacyDeltas: [],
    })
  })

  it('uses bytes from the deleted row after a concurrent source revision', async () => {
    const snapshot = {
      id: 'doc-1',
      knowledgeBaseId: 'knowledge-base-1',
      fileUrl: 'data:text/plain;base64,QQ==',
      fileSize: 100,
      uploadedBy: 'external-collaborator',
      connectorId: null,
      workspaceId: 'workspace-1',
      kbUserId: 'knowledge-owner',
    }
    dbChainMockFns.where.mockResolvedValueOnce([snapshot])
    dbChainMockFns.for.mockResolvedValueOnce([
      { id: 'knowledge-base-1', workspaceId: 'workspace-1', userId: 'knowledge-owner' },
    ])
    dbChainMockFns.returning.mockResolvedValueOnce([{ ...snapshot, fileSize: 200 }])

    await expect(hardDeleteDocuments(['doc-1'], 'request-1')).resolves.toBe(1)

    expect(mockApplyStorageUsageDeltasInTx).toHaveBeenCalledWith(expect.anything(), {
      workspaceDeltas: [{ context: STORAGE_CONTEXT, deltaBytes: -200 }],
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
    dbChainMockFns.returning.mockResolvedValueOnce([
      {
        id: 'connector-doc',
        knowledgeBaseId: 'knowledge-base-1',
        fileUrl: 'data:text/plain;base64,QQ==',
        fileSize: 500,
        uploadedBy: null,
        connectorId: 'connector-1',
      },
    ])

    const deletedCount = await hardDeleteDocuments(['connector-doc'], 'request-1')

    expect(deletedCount).toBe(1)
    expect(mockResolveStorageBillingContext).toHaveBeenCalledWith('workspace-1')
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
})

describe('organization document storage deletion', () => {
  beforeEach(() => {
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
      dbChainMockFns.returning.mockResolvedValueOnce([
        {
          id: 'org-doc',
          knowledgeBaseId: 'org-kb',
          fileUrl: null,
          fileSize: 100,
          uploadedBy: 'creator',
          connectorId,
        },
      ])
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
