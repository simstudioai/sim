import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { billingStorageMock, billingStorageMockFns } from '@sim/testing/mocks/billing-storage.mock'
import { projectMembershipMock } from '@sim/testing/mocks/project-membership.mock'
import { storageServiceMock, storageServiceMockFns } from '@sim/testing/mocks/storage-service.mock'
import { uploadsMock, uploadsMockFns } from '@sim/testing/mocks/uploads.mock'
import {
  workspaceFileFoldersMock,
  workspaceFileFoldersMockFns,
} from '@sim/testing/mocks/workspace-file-folders.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/projects/membership', () => projectMembershipMock)
vi.mock('@/lib/billing/storage', () => billingStorageMock)

vi.mock('@/lib/uploads', () => uploadsMock)

vi.mock('@/lib/uploads/core/storage-service', () => storageServiceMock)

vi.mock(
  '@/lib/uploads/contexts/workspace/workspace-file-folder-manager',
  () => workspaceFileFoldersMock
)

import { uploadWorkspaceFile } from '@/lib/uploads/contexts/workspace/workspace-file-manager'

const mockUploadFile = storageServiceMockFns.mockUploadFile
const mockIncrementStorageUsageForBillingContextInTx =
  billingStorageMockFns.mockIncrementStorageUsageForBillingContextInTx
const mockMaybeNotifyStorageLimitForBillingContext =
  billingStorageMockFns.mockMaybeNotifyStorageLimitForBillingContext
const mockResolveStorageBillingContext = billingStorageMockFns.mockResolveStorageBillingContext
const mockResolveWorkspaceFileFolderTarget =
  workspaceFileFoldersMockFns.mockResolveWorkspaceFileFolderTarget

workspaceFileFoldersMockFns.mockBuildWorkspaceFileFolderPathMap.mockImplementation(() => new Map())
workspaceFileFoldersMockFns.mockNormalizeWorkspaceFileItemName.mockImplementation(
  (name: string) => name
)

uploadsMockFns.mockGetServePathPrefix.mockImplementation(() => '/api/files/serve/s3/')

const STORAGE_CONTEXT = {
  workspaceId: 'workspace-1',
  billedAccountUserId: 'workspace-owner',
  billingEntity: { type: 'organization' as const, id: 'workspace-org' },
  plan: 'team_25000',
  customStorageLimitGB: null,
}

describe('workspace file storage attribution', () => {
  beforeEach(() => {
    resetDbChainMock()
    mockResolveStorageBillingContext.mockResolvedValue(STORAGE_CONTEXT)
    mockResolveWorkspaceFileFolderTarget.mockResolvedValue(null)
    mockIncrementStorageUsageForBillingContextInTx.mockResolvedValue(5)
    mockMaybeNotifyStorageLimitForBillingContext.mockResolvedValue(undefined)
    mockUploadFile.mockImplementation(async ({ customKey }) => ({ key: customKey }))
  })

  it.each(['external-collaborator', 'personal-api-key-user'])(
    'charges the workspace payer while retaining %s as uploader metadata',
    async (actorUserId) => {
      dbChainMockFns.returning
        .mockImplementationOnce(async () => [
          {
            id: 'file-1',
            key: mockUploadFile.mock.calls.at(-1)?.[0].customKey,
            userId: actorUserId,
            workspaceId: 'workspace-1',
            folderId: null,
            context: 'workspace',
            chatId: null,
            originalName: 'note.txt',
            displayName: 'note.txt',
            contentType: 'text/plain',
            size: 5,
            sizeBytes: 5,
            deletedAt: null,
            uploadedAt: new Date(),
            updatedAt: new Date(),
            contentUpdatedAt: new Date(),
          },
        ])
        .mockResolvedValueOnce([{ id: 'file-1' }])

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
