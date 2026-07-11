/**
 * @vitest-environment node
 */
import { dbChainMock, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckStorageQuota,
  mockCheckStorageQuotaForBillingContext,
  mockDecrementStorageUsageForBillingContextInTx,
  mockDecrementStorageUsageInTx,
  mockIncrementStorageUsage,
  mockIncrementStorageUsageForBillingContextInTx,
  mockMaybeNotifyStorageLimitForBillingContext,
  mockResolveStorageBillingContext,
} = vi.hoisted(() => ({
  mockCheckStorageQuota: vi.fn(),
  mockCheckStorageQuotaForBillingContext: vi.fn(),
  mockDecrementStorageUsageForBillingContextInTx: vi.fn(),
  mockDecrementStorageUsageInTx: vi.fn(),
  mockIncrementStorageUsage: vi.fn(),
  mockIncrementStorageUsageForBillingContextInTx: vi.fn(),
  mockMaybeNotifyStorageLimitForBillingContext: vi.fn(),
  mockResolveStorageBillingContext: vi.fn(),
}))

vi.mock('@sim/db', () => dbChainMock)

vi.mock('@/lib/billing/storage', () => ({
  checkStorageQuota: mockCheckStorageQuota,
  checkStorageQuotaForBillingContext: mockCheckStorageQuotaForBillingContext,
  decrementStorageUsageForBillingContextInTx: mockDecrementStorageUsageForBillingContextInTx,
  decrementStorageUsageInTx: mockDecrementStorageUsageInTx,
  incrementStorageUsage: mockIncrementStorageUsage,
  incrementStorageUsageForBillingContextInTx: mockIncrementStorageUsageForBillingContextInTx,
  maybeNotifyStorageLimitForBillingContext: mockMaybeNotifyStorageLimitForBillingContext,
  resolveStorageBillingContext: mockResolveStorageBillingContext,
}))

import { createDocumentRecords, createSingleDocument } from '@/lib/knowledge/documents/service'

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
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        id: 'knowledge-base-1',
        workspaceId: 'workspace-1',
        userId: 'knowledge-owner',
      },
    ])
    mockResolveStorageBillingContext.mockResolvedValue(STORAGE_CONTEXT)
    mockCheckStorageQuotaForBillingContext.mockResolvedValue({ allowed: true })
    mockIncrementStorageUsageForBillingContextInTx.mockResolvedValue(5)
    mockMaybeNotifyStorageLimitForBillingContext.mockResolvedValue(undefined)
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
      expect(mockIncrementStorageUsage).not.toHaveBeenCalled()
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
})
