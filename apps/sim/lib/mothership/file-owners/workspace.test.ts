/** @vitest-environment node */
import {
  readWorkspaceFileMetadataMock,
  readWorkspaceFileMetadataMockFns,
} from '@sim/testing/mocks/read-workspace-file-metadata.mock'
import { beforeEach, expect, it, vi } from 'vitest'

vi.mock(
  '@/lib/workspace-files/application/read-workspace-file-metadata',
  () => readWorkspaceFileMetadataMock
)

import { workspaceFileOwnerAdapter } from '@/lib/mothership/file-owners/workspace'

const readMetadata = readWorkspaceFileMetadataMockFns.mockReadWorkspaceFileMetadata
const owner = { entityType: 'workspace' as const, entityId: 'workspace' }
const ingress = { userId: 'user', workspaceId: 'workspace', chatId: 'chat' }

beforeEach(() => {
  readMetadata.mockReset()
})

it.each([
  [
    'keeps a chat upload on its uploads path so the reader resolves it',
    { id: 'upload', name: 'notes.md', folderPath: null, vfsNamespace: 'uploads' },
    'uploads/notes.md',
  ],
  [
    'places a workspace file under its folder path',
    { id: 'file', name: 'notes.md', folderPath: 'Reports' },
    'files/Reports/notes.md',
  ],
])('%s', async (_name, stored, path) => {
  readMetadata.mockResolvedValue({ file: stored })
  const file = await workspaceFileOwnerAdapter.readChatMetadata(ingress, {
    owner,
    fileId: stored.id,
  })
  expect(file.path).toBe(path)
})

it('refuses a file owned by another workspace before reading its metadata', async () => {
  await expect(
    workspaceFileOwnerAdapter.readChatMetadata(ingress, {
      owner: { entityType: 'workspace', entityId: 'other-workspace' },
      fileId: 'file',
    })
  ).rejects.toMatchObject({ code: 'not_found' })
  expect(readMetadata).not.toHaveBeenCalled()
})
