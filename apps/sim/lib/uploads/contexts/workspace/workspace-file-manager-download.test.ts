import { billingStorageMock } from '@sim/testing/mocks/billing-storage.mock'
import { storageServiceMock, storageServiceMockFns } from '@sim/testing/mocks/storage-service.mock'
import { uploadsMock, uploadsMockFns } from '@sim/testing/mocks/uploads.mock'
import {
  workspaceFileFoldersMock,
  workspaceFileFoldersMockFns,
} from '@sim/testing/mocks/workspace-file-folders.mock'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/billing/storage', () => billingStorageMock)

vi.mock('@/lib/uploads', () => uploadsMock)

vi.mock('@/lib/uploads/core/storage-service', () => storageServiceMock)

vi.mock(
  '@/lib/uploads/contexts/workspace/workspace-file-folder-manager',
  () => workspaceFileFoldersMock
)

import { assertKnownSizeWithinLimit, isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import {
  fetchWorkspaceFileBuffer,
  type WorkspaceFileRecord,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'

workspaceFileFoldersMockFns.mockBuildWorkspaceFileFolderPathMap.mockImplementation(() => new Map())
workspaceFileFoldersMockFns.mockNormalizeWorkspaceFileItemName.mockImplementation(
  (name: string) => name
)

const mockDownloadFile = storageServiceMockFns.mockDownloadFile

uploadsMockFns.mockGetServePathPrefix.mockImplementation(() => '/api/files/serve/s3/')

const FILE: WorkspaceFileRecord = {
  id: 'file-1',
  workspaceId: 'workspace-1',
  name: 'notes.txt',
  key: 'workspace/workspace-1/notes.txt',
  path: '/api/files/serve/workspace/workspace-1/notes.txt',
  size: 5,
  type: 'text/plain',
  uploadedBy: 'user-1',
  uploadedAt: new Date('2026-09-01T00:00:00.000Z'),
  updatedAt: new Date('2026-09-01T00:00:00.000Z'),
}

function sizeLimitError(): unknown {
  try {
    assertKnownSizeWithinLimit(2, 1, 'test')
  } catch (error) {
    return error
  }
  throw new Error('assertKnownSizeWithinLimit did not throw')
}

describe('fetchWorkspaceFileBuffer', () => {
  it('surfaces a cancelled read as the abort rather than a download failure', async () => {
    const controller = new AbortController()
    mockDownloadFile.mockImplementation(async () => {
      controller.abort()
      throw new Error('read interrupted')
    })

    await expect(
      fetchWorkspaceFileBuffer(FILE, { maxBytes: 10, signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('rethrows a byte-ceiling breach unwrapped', async () => {
    mockDownloadFile.mockRejectedValue(sizeLimitError())

    await expect(fetchWorkspaceFileBuffer(FILE, { maxBytes: 10 })).rejects.toSatisfy(
      isPayloadSizeLimitError
    )
  })
})
