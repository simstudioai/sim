/** @vitest-environment node */
import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const values = vi.fn()
  const insert = vi.fn(() => ({
    values: (metadata: Record<string, unknown>) => {
      values(metadata)
      return { onConflictDoNothing: () => ({ returning: async () => [metadata] }) }
    },
  }))
  return { values, insert, upload: vi.fn(), loadFolders: vi.fn() }
})
vi.mock('@sim/db', () => ({
  db: {
    transaction: async (run: (tx: { insert: typeof mocks.insert }) => Promise<unknown>) =>
      run({ insert: mocks.insert }),
  },
}))
vi.mock('@/lib/billing/storage', () => ({
  decrementStorageUsageForBillingContextInTx: vi.fn(),
  incrementStorageUsageForBillingContextInTx: vi.fn(),
  maybeNotifyStorageLimitForBillingContext: vi.fn(),
  resolveStorageBillingContext: vi.fn(),
}))
vi.mock('@/lib/folders/locks', () => ({ acquireFolderMutationLock: vi.fn() }))
vi.mock('@/lib/realtime/notify', () => ({ notifyWorkspaceFilesChanged: vi.fn() }))
vi.mock('@/lib/uploads', () => ({ getServePathPrefix: () => '/api/files/serve/' }))
vi.mock('@/lib/uploads/core/storage-service', () => ({
  deleteFile: vi.fn(),
  downloadFile: vi.fn(),
  hasCloudStorage: () => false,
  headObject: vi.fn(),
  uploadFile: mocks.upload,
}))
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-folder-manager', () => ({
  assertWorkspaceFileFolderTarget: async () => null,
  buildWorkspaceFileFolderPathMap: () => new Map(),
  fileNameExistsInWorkspaceFolder: async () => false,
  findWorkspaceFileFolderIdByPath: vi.fn(),
  getWorkspaceFileFolderPath: vi.fn(),
  listWorkspaceFileFolders: async () => [],
  normalizeWorkspaceFileItemName: (name: string) => name,
  resolveWorkspaceFileFolderTarget: async () => null,
}))

vi.mock('@/lib/folders/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/folders/queries')>()),
  loadActiveFolderPathIndex: mocks.loadFolders,
}))

import { buildFolderPathIndex } from '@/lib/folders/paths'
import {
  uploadWorkspaceFile,
  workspaceFileVfsPath,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.upload.mockImplementation(async ({ fileName }: { fileName: string }) => ({ key: fileName }))
})

it.each([
  { name: 'Finance/Legal', path: '/Finance%2FLegal', display: 'Finance\\/Legal' },
  { name: 'Finance\\Legal', path: '/Finance%5CLegal', display: 'Finance\\\\Legal' },
  { name: 'Q3 Reports', path: '/Q3%20Reports', display: 'Q3 Reports' },
])(
  'preserves the destination identity and returned path for $name',
  async ({ name, path, display }) => {
    mocks.loadFolders.mockResolvedValue(
      buildFolderPathIndex([{ id: 'folder-1', name, parentId: null }])
    )
    const file = await uploadWorkspaceFile(
      'workspace',
      'author',
      Buffer.from('zip'),
      'archive.zip',
      'application/zip',
      {
        folderPath: path,
        exactName: true,
      }
    )
    expect(file.folderPath).toBe(display)
    expect(file.folderId).toBe('folder-1')
    expect(workspaceFileVfsPath(file)).toBe(`files${path}/archive.zip`)
    expect(mocks.loadFolders).toHaveBeenCalledTimes(2)
    expect(mocks.values).toHaveBeenCalledWith(expect.objectContaining({ folderId: 'folder-1' }))
  }
)

it('refuses a nonexistent destination before uploading any bytes', async () => {
  mocks.loadFolders.mockResolvedValue(buildFolderPathIndex([]))
  await expect(
    uploadWorkspaceFile(
      'workspace',
      'author',
      Buffer.from('zip'),
      'archive.zip',
      'application/zip',
      {
        folderPath: '/Missing',
        exactName: false,
      }
    )
  ).rejects.toMatchObject({ code: 'not_found' })
  expect(mocks.upload).not.toHaveBeenCalled()
})
