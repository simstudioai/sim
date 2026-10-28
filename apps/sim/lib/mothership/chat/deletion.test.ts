import { copilotChats } from '@sim/db/schema'
import { chatCleanupMock, chatCleanupMockFns } from '@sim/testing/mocks/chat-cleanup.mock'
import { queueTableRows, resetDbChainMock } from '@sim/testing/mocks/database.mock'
import { mothershipAsyncRunsMock } from '@sim/testing/mocks/mothership-async-runs.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDeliverRunStops } = vi.hoisted(() => ({ mockDeliverRunStops: vi.fn() }))

vi.mock('@/lib/cleanup/chat-cleanup', () => chatCleanupMock)
vi.mock('@/lib/mothership/async-runs/repository', () => mothershipAsyncRunsMock)
vi.mock('@/lib/mothership/request/application/stop-delivery', () => ({
  deliverRunStops: mockDeliverRunStops,
}))

import { deleteCopilotChat } from '@/lib/mothership/chat/deletion'

const { mockPrepareChatCleanup, mockExecuteChatCleanup } = chatCleanupMockFns
const CHAT_ID = 'chat-1'

describe('deleteCopilotChat', () => {
  beforeEach(() => {
    resetDbChainMock()
    mockExecuteChatCleanup.mockReset()
  })

  it('purges the copilot backend data and files of a chat it deletes', async () => {
    queueTableRows(copilotChats, [{ workspaceId: 'ws-1', organizationId: null }])

    expect(await deleteCopilotChat({ chatId: CHAT_ID, userId: 'user-1' })).toEqual({
      workspaceId: 'ws-1',
      organizationId: null,
    })
    expect(mockPrepareChatCleanup).toHaveBeenCalledWith([CHAT_ID], expect.any(String))
    expect(mockExecuteChatCleanup).toHaveBeenCalledTimes(1)
  })

  it('purges nothing when the chat is not the caller’s', async () => {
    queueTableRows(copilotChats, [])

    expect(await deleteCopilotChat({ chatId: CHAT_ID, userId: 'user-2' })).toBeNull()
    expect(mockExecuteChatCleanup).not.toHaveBeenCalled()
  })

  it('still reports the committed delete when the purge fails', async () => {
    queueTableRows(copilotChats, [{ workspaceId: null, organizationId: 'org-1' }])
    mockExecuteChatCleanup.mockRejectedValueOnce(new Error('backend down'))

    expect(await deleteCopilotChat({ chatId: CHAT_ID, userId: 'user-1' })).toEqual({
      workspaceId: null,
      organizationId: 'org-1',
    })
  })
})
