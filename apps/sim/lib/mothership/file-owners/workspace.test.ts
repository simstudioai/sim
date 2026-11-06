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

it('places a workspace file under its folder path', async () => {
  readMetadata.mockResolvedValue({ file: { id: 'file', name: 'notes.md', folderPath: 'Reports' } })
  const file = await workspaceFileOwnerAdapter.readChatMetadata(ingress, { owner, fileId: 'file' })
  expect(file.path).toBe('files/Reports/notes.md')
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
