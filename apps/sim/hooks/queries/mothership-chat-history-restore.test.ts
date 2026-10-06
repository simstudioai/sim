import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRequestJson } = vi.hoisted(() => ({ mockRequestJson: vi.fn() }))

vi.mock('@/lib/api/client/request', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/client/request')>()),
  requestJson: mockRequestJson,
}))

import {
  type MothershipChatHistory,
  mothershipChatHistoryQueryOptions,
} from '@/hooks/queries/mothership-chats'
import { useMothershipQueueStore } from '@/stores/mothership-queue/store'

const history: MothershipChatHistory = {
  id: 'chat-1',
  mode: 'agent',
  title: 'Restored',
  messages: [],
  activeStreamId: null,
  resources: [],
}

/** Whether the queue store takes a send for the chat, i.e. whether its delete still holds. */
function takesSends(chatId: string): boolean {
  useMothershipQueueStore.getState().enqueue(chatId, { id: 'probe', content: 'probe' })
  return useMothershipQueueStore.getState().queues[chatId] !== undefined
}

describe('chat history read after a delete', () => {
  beforeEach(() => {
    useMothershipQueueStore.getState().reset()
    mockRequestJson.mockReset()
  })

  it('reopens a chat this tab saw deleted once the server returns it again', async () => {
    useMothershipQueueStore.getState().clearChat(history.id)
    mockRequestJson.mockResolvedValue({ chat: history })

    await new QueryClient().fetchQuery(mothershipChatHistoryQueryOptions(history.id))

    expect(takesSends(history.id)).toBe(true)
  })

  it('keeps the delete when the read returning the chat began before it', async () => {
    let answer!: () => void
    mockRequestJson.mockReturnValue(
      new Promise((resolve) => {
        answer = () => resolve({ chat: history })
      })
    )

    const read = new QueryClient().fetchQuery(mothershipChatHistoryQueryOptions(history.id))
    useMothershipQueueStore.getState().clearChat(history.id)
    answer()
    await read

    expect(takesSends(history.id)).toBe(false)
  })
})
