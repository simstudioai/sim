/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckStorageQuota,
  mockCheckStorageQuotaForBillingContext,
  mockIncrementStorageUsage,
  mockIncrementStorageUsageForBillingContext,
  mockInsertFileMetadata,
  mockResolveStorageBillingContext,
  mockUploadFile,
} = vi.hoisted(() => ({
  mockCheckStorageQuota: vi.fn(),
  mockCheckStorageQuotaForBillingContext: vi.fn(),
  mockIncrementStorageUsage: vi.fn(),
  mockIncrementStorageUsageForBillingContext: vi.fn(),
  mockInsertFileMetadata: vi.fn(),
  mockResolveStorageBillingContext: vi.fn(),
  mockUploadFile: vi.fn(),
}))

vi.mock('@/lib/billing/storage', () => ({
  checkStorageQuota: mockCheckStorageQuota,
  checkStorageQuotaForBillingContext: mockCheckStorageQuotaForBillingContext,
  decrementStorageUsage: vi.fn(),
  decrementStorageUsageForBillingContext: vi.fn(),
  incrementStorageUsage: mockIncrementStorageUsage,
  incrementStorageUsageForBillingContext: mockIncrementStorageUsageForBillingContext,
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

vi.mock('@/lib/uploads/server/metadata', () => ({
  getFileMetadataByKey: vi.fn(),
  insertFileMetadata: mockInsertFileMetadata,
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
    mockResolveStorageBillingContext.mockResolvedValue(STORAGE_CONTEXT)
    mockCheckStorageQuotaForBillingContext.mockResolvedValue({ allowed: true })
    mockIncrementStorageUsageForBillingContext.mockResolvedValue(undefined)
    mockUploadFile.mockResolvedValue({
      key: 'workspace/workspace-1/123-abc-note.txt',
    })
    mockInsertFileMetadata.mockResolvedValue({
      id: 'file-1',
    })
  })

  it.each(['external-collaborator', 'personal-api-key-user'])(
    'charges the workspace payer while retaining %s as uploader metadata',
    async (actorUserId) => {
      await uploadWorkspaceFile(
        'workspace-1',
        actorUserId,
        Buffer.from('hello'),
        'note.txt',
        'text/plain'
      )

      expect(mockResolveStorageBillingContext).toHaveBeenCalledWith('workspace-1')
      expect(mockCheckStorageQuotaForBillingContext).toHaveBeenCalledWith(STORAGE_CONTEXT, 5)
      expect(mockIncrementStorageUsageForBillingContext).toHaveBeenCalledWith(STORAGE_CONTEXT, 5)
      expect(mockCheckStorageQuota).not.toHaveBeenCalled()
      expect(mockIncrementStorageUsage).not.toHaveBeenCalled()
      expect(mockInsertFileMetadata).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: actorUserId,
          workspaceId: 'workspace-1',
        })
      )
    }
  )
})
