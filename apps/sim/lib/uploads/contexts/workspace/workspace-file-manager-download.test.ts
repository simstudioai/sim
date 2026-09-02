/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDownloadFile } = vi.hoisted(() => ({
  mockDownloadFile: vi.fn(),
}))

vi.mock('@/lib/billing/storage', () => ({
  decrementStorageUsageForBillingContextInTx: vi.fn(),
  incrementStorageUsageForBillingContextInTx: vi.fn(),
  maybeNotifyStorageLimitForBillingContext: vi.fn(),
  resolveStorageBillingContext: vi.fn(),
}))

vi.mock('@/lib/uploads', () => ({
  getServePathPrefix: vi.fn(() => '/api/files/serve/s3/'),
}))

vi.mock('@/lib/uploads/core/storage-service', () => ({
  deleteFile: vi.fn(),
  downloadFile: mockDownloadFile,
  hasCloudStorage: vi.fn(() => false),
  headObject: vi.fn(),
  uploadFile: vi.fn(),
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-folder-manager', () => ({
  assertWorkspaceFileFolderTarget: vi.fn(async () => null),
  buildWorkspaceFileFolderPathMap: vi.fn(() => new Map()),
  fileNameExistsInWorkspaceFolder: vi.fn(async () => false),
  findWorkspaceFileFolderIdByPath: vi.fn(),
  getWorkspaceFileFolderPath: vi.fn(),
  listWorkspaceFileFolders: vi.fn(async () => []),
  normalizeWorkspaceFileItemName: vi.fn((name: string) => name),
  resolveWorkspaceFileFolderTarget: vi.fn(async () => null),
}))

import { assertKnownSizeWithinLimit, isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import {
  fetchWorkspaceFileBuffer,
  type WorkspaceFileRecord,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'

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
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('forwards the byte ceiling and the cancellation signal to storage', async () => {
    const bytes = Buffer.from('hello')
    mockDownloadFile.mockResolvedValue(bytes)
    const signal = new AbortController().signal

    await expect(fetchWorkspaceFileBuffer(FILE, { maxBytes: 10, signal })).resolves.toBe(bytes)
    expect(mockDownloadFile).toHaveBeenCalledWith({
      key: FILE.key,
      context: 'workspace',
      maxBytes: 10,
      signal,
    })
  })

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

  it('wraps other transport failures', async () => {
    mockDownloadFile.mockRejectedValue(new Error('socket hang up'))

    await expect(fetchWorkspaceFileBuffer(FILE, { maxBytes: 10 })).rejects.toThrow(
      'Failed to download file: socket hang up'
    )
  })
})
