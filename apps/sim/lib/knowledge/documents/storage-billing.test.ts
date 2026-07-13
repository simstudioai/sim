/**
 * @vitest-environment node
 */
import { dbChainMock, dbChainMockFns, resetDbChainMock } from '@sim/testing'
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
} = vi.hoisted(() => ({
  mockApplyStorageUsageDeltasInTx: vi.fn(),
  mockCheckStorageQuota: vi.fn(),
  mockCheckStorageQuotaForBillingContext: vi.fn(),
  mockDecrementStorageUsageForBillingContextInTx: vi.fn(),
  mockIncrementStorageUsageForBillingContextInTx: vi.fn(),
  mockMaybeNotifyStorageLimitForBillingContext: vi.fn(),
  mockResolveStorageBillingContext: vi.fn(),
  mockGetFileMetadataByKeys: vi.fn(),
}))

vi.mock('@sim/db', () => dbChainMock)

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

import {
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

  it('uses server-known file metadata size for quota, ledger, and document row', async () => {
    const fileUrl = '/api/files/serve/kb%2Fverified-file?context=knowledge-base'
    mockGetFileMetadataByKeys.mockResolvedValue([
      {
        key: 'kb/verified-file',
        workspaceId: 'workspace-1',
        userId: 'external-collaborator',
        size: 8,
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
  })

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

  it('splits hard deletion into bounded 250-document transactions', async () => {
    const documentIds = Array.from({ length: 251 }, (_, index) => `doc-${index}`)

    await expect(hardDeleteDocuments(documentIds, 'request-1')).resolves.toBe(0)

    expect(dbChainMockFns.select).toHaveBeenCalledTimes(2)
    expect(dbChainMockFns.transaction).not.toHaveBeenCalled()
  })
})
