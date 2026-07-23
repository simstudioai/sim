/**
 * @vitest-environment node
 */
import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockIncrementStorageUsageForBillingContextInTx,
  mockMaybeNotifyStorageLimitForBillingContext,
  mockResolveStorageBillingContext,
  mockUploadFile,
} = vi.hoisted(() => ({
  mockIncrementStorageUsageForBillingContextInTx: vi.fn(),
  mockMaybeNotifyStorageLimitForBillingContext: vi.fn(),
  mockResolveStorageBillingContext: vi.fn(),
  mockUploadFile: vi.fn(),
}))

vi.mock('@/lib/billing/storage', () => ({
  decrementStorageUsageForBillingContextInTx: vi.fn(),
  incrementStorageUsageForBillingContextInTx: mockIncrementStorageUsageForBillingContextInTx,
  maybeNotifyStorageLimitForBillingContext: mockMaybeNotifyStorageLimitForBillingContext,
  resolveStorageBillingContext: mockResolveStorageBillingContext,
}))

vi.mock('@/lib/uploads', () => ({
  getServePathPrefix: vi.fn(() => '/api/files/serve/s3/'),
}))

vi.mock('@/lib/uploads/core/storage-service', () => ({
  deleteFile: vi.fn(),
  downloadFile: vi.fn(),
  hasCloudStorage: vi.fn(() => false),
  headObject: vi.fn(),
  uploadFile: mockUploadFile,
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-folder-manager', () => ({
  assertWorkspaceFileFolderTarget: vi.fn(async () => null),
  buildWorkspaceFileFolderPathMap: vi.fn(() => new Map()),
  fileNameExistsInWorkspaceFolder: vi.fn(async () => false),
  findWorkspaceFileFolderIdByPath: vi.fn(),
  getWorkspaceFileFolderPath: vi.fn(),
  listWorkspaceFileFolders: vi.fn(async () => []),
  normalizeWorkspaceFileItemName: vi.fn((name: string) => name),
}))

import { uploadWorkspaceFile } from '@/lib/uploads/contexts/workspace/workspace-file-manager'

const STORAGE_CONTEXT = {
  workspaceId: 'workspace-1',
  billedAccountUserId: 'workspace-owner',
  billingEntity: { type: 'organization' as const, id: 'workspace-org' },
  plan: 'team_25000',
  customStorageLimitGB: null,
}

describe('workspace file storage attribution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockResolveStorageBillingContext.mockResolvedValue(STORAGE_CONTEXT)
    mockIncrementStorageUsageForBillingContextInTx.mockResolvedValue(5)
    mockMaybeNotifyStorageLimitForBillingContext.mockResolvedValue(undefined)
    mockUploadFile.mockResolvedValue({
      key: 'workspace/workspace-1/123-abc-note.txt',
    })
  })

  it.each(['external-collaborator', 'personal-api-key-user'])(
    'charges the workspace payer while retaining %s as uploader metadata',
    async (actorUserId) => {
      dbChainMockFns.returning.mockResolvedValueOnce([
        {
          id: 'file-1',
          key: 'workspace/workspace-1/123-abc-note.txt',
          userId: actorUserId,
          workspaceId: 'workspace-1',
          folderId: null,
          context: 'workspace',
          chatId: null,
          originalName: 'note.txt',
          displayName: 'note.txt',
          contentType: 'text/plain',
          size: 5,
          deletedAt: null,
          uploadedAt: new Date(),
          updatedAt: new Date(),
        },
      ])

      await uploadWorkspaceFile(
        'workspace-1',
        actorUserId,
        Buffer.from('hello'),
        'note.txt',
        'text/plain'
      )

      expect(mockResolveStorageBillingContext).toHaveBeenCalledWith('workspace-1')
      expect(mockIncrementStorageUsageForBillingContextInTx).toHaveBeenCalledWith(
        expect.any(Object),
        STORAGE_CONTEXT,
        5
      )
      expect(dbChainMockFns.values).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: actorUserId,
          workspaceId: 'workspace-1',
        })
      )
    }
  )
})
