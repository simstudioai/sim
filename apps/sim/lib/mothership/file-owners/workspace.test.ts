/** @vitest-environment node */
import { beforeEach, expect, it, vi } from 'vitest'

const { readMetadata } = vi.hoisted(() => ({ readMetadata: vi.fn() }))
vi.mock('@/lib/workspace-files/application/read-workspace-file-metadata', () => ({
  readWorkspaceFileMetadata: { execute: readMetadata },
}))

import { workspaceFileOwnerAdapter } from '@/lib/mothership/file-owners/workspace'

const owner = { entityType: 'workspace' as const, entityId: 'workspace' }
const ingress = { userId: 'user', workspaceId: 'workspace', chatId: 'chat' }

beforeEach(() => {
  readMetadata.mockReset()
})

it('keeps a chat upload on its uploads path so the reader resolves it', async () => {
  readMetadata.mockResolvedValue({
    file: { id: 'upload', name: 'notes.md', folderPath: null, vfsNamespace: 'uploads' },
  })
  const file = await workspaceFileOwnerAdapter.readChatMetadata(ingress, {
    owner,
    fileId: 'upload',
  })
  expect(file.path).toBe('uploads/notes.md')
})

it('places a workspace file under its folder path', async () => {
  readMetadata.mockResolvedValue({
    file: { id: 'file', name: 'notes.md', folderPath: 'Reports' },
  })
  const file = await workspaceFileOwnerAdapter.readChatMetadata(ingress, {
    owner,
    fileId: 'file',
  })
  expect(file.path).toBe('files/Reports/notes.md')
})
