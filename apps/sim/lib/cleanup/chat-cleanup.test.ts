import { copilotChats, copilotMessages, workspaceFiles } from '@sim/db/schema'
import { queueTableRows, resetDbChainMock } from '@sim/testing/mocks/database.mock'
import { storageServiceMockFns } from '@sim/testing/mocks/storage-service.mock'
import { uploadsMock, uploadsMockFns } from '@sim/testing/mocks/uploads.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/uploads', () => uploadsMock)

import { prepareChatCleanup } from '@/lib/cleanup/chat-cleanup'
import { inlineChatImageKey } from '@/lib/mothership/chat/inline-image-key'

const chatId = '3f0c2a52-8a43-4d4b-9b5f-0b3c7a1e2d10'

function attachment(key: string) {
  return { id: 'wf_x', key, filename: 'x.png', media_type: 'image/png', size: 1 }
}

/** Purges one deleted chat whose message rows are `messages`; returns the deleted keys by context. */
async function purge(messages: Record<string, unknown>[]) {
  queueTableRows(workspaceFiles, [])
  queueTableRows(
    copilotMessages,
    messages.map((content) => ({ chatId, content }))
  )
  const cleanup = await prepareChatCleanup([chatId], 'test')
  queueTableRows(copilotChats, [])
  await cleanup.execute()
  return Object.fromEntries(
    storageServiceMockFns.mockDeleteFiles.mock.calls.map(([keys, context]) => [context, keys])
  )
}

describe('chat purge storage', () => {
  beforeEach(() => {
    resetDbChainMock()
    uploadsMockFns.mockIsUsingCloudStorage.mockReturnValue(true)
    storageServiceMockFns.mockDeleteFiles.mockReset()
    storageServiceMockFns.mockDeleteFiles.mockResolvedValue({ deleted: 1, failed: [] })
  })

  it('deletes only copilot-storage attachment keys as copilot storage', async () => {
    // A fork carries its source's key when the file's copy failed or the file was deleted, and
    // the copilot bucket can be the workspace bucket, so a workspace key here is another chat's file.
    const deleted = await purge([
      {
        role: 'user',
        content: 'look',
        fileAttachments: [
          attachment('workspace/ws-1/1700-abc-shared.png'),
          attachment('assistant/org-1/user-1/u1/shared.png'),
          attachment('copilot/1234/legacy.png'),
        ],
      },
    ])
    expect(deleted).toEqual({ copilot: ['copilot/1234/legacy.png'] })
  })

  it('deletes the inline images an assistant message published', async () => {
    const deleted = await purge([
      {
        role: 'assistant',
        requestId: 'req-1',
        content: 'Here: ![chart](files/chart.png) and `![code](files/no.png)`',
        contentBlocks: [{ type: 'text', content: '![other](/tmp/out.png)' }],
      },
      { role: 'user', requestId: 'req-2', content: '![u](files/u.png)' },
      { role: 'assistant', content: '![x](files/x.png)' },
    ])
    expect(deleted).toEqual({
      mothership: [
        inlineChatImageKey(chatId, 'req-1', 'files/chart.png'),
        inlineChatImageKey(chatId, 'req-1', '/tmp/out.png'),
      ],
    })
  })
})
