import {
  apiClientRequestMock,
  apiClientRequestMockFns,
} from '@sim/testing/mocks/api-client-request.mock'
import { reactQueryMock } from '@sim/testing/mocks/react-query.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api/client/request', () => apiClientRequestMock)
vi.mock('@tanstack/react-query', () => reactQueryMock)

import {
  fetchMothershipChatHistory,
  type MothershipChatHistory,
  useRestoreMothershipChat,
} from '@/hooks/queries/mothership-chats'
import { useMothershipQueueStore } from '@/stores/mothership-queue/store'

const mockRequestJson = apiClientRequestMockFns.mockRequestJson

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

/** A server answer the test releases when it chooses. */
function deferredAnswer(value: unknown): () => void {
  let answer!: () => void
  mockRequestJson.mockReturnValue(
    new Promise((resolve) => {
      answer = () => resolve(value)
    })
  )
  return answer
}

/** The options `useRestoreMothershipChat` hands to `useMutation` (the mock returns them). */
interface RestoreMutation {
  mutationFn: (chatId: string) => Promise<void>
  onMutate?: (chatId: string) => { deleteSeen?: number }
  onSuccess: (data: undefined, chatId: string, context?: { deleteSeen?: number }) => void
}

async function restore(chatId: string, whileInFlight: () => void = () => {}) {
  const mutation = useRestoreMothershipChat() as unknown as RestoreMutation
  const context = mutation.onMutate?.(chatId)
  const answer = deferredAnswer({ success: true })
  const done = mutation.mutationFn(chatId)
  whileInFlight()
  answer()
  await done
  mutation.onSuccess(undefined, chatId, context)
}

describe('lifting a chat delete', () => {
  beforeEach(() => {
    useMothershipQueueStore.getState().reset()
    mockRequestJson.mockReset()
  })

  it('reopens a chat this tab saw deleted once the server returns it again', async () => {
    useMothershipQueueStore.getState().clearChat(history.id)
    mockRequestJson.mockResolvedValue({ chat: history })

    await fetchMothershipChatHistory(history.id)

    expect(takesSends(history.id)).toBe(true)
  })

  it('keeps the delete when the read returning the chat began before it', async () => {
    const answer = deferredAnswer({ chat: history })
    const read = fetchMothershipChatHistory(history.id)
    useMothershipQueueStore.getState().clearChat(history.id)
    answer()
    await read

    expect(takesSends(history.id)).toBe(false)
  })

  it('keeps a newer delete that lands while a read after an earlier one is in flight', async () => {
    useMothershipQueueStore.getState().clearChat(history.id)
    const answer = deferredAnswer({ chat: history })
    const read = fetchMothershipChatHistory(history.id)
    useMothershipQueueStore.getState().reopenChat(history.id)
    useMothershipQueueStore.getState().clearChat(history.id)
    answer()
    await read

    expect(takesSends(history.id)).toBe(false)
  })

  it('reopens a chat restored from Recently Deleted', async () => {
    useMothershipQueueStore.getState().clearChat(history.id)

    await restore(history.id)

    expect(takesSends(history.id)).toBe(true)
  })

  it('keeps a delete that lands while the restore is in flight', async () => {
    useMothershipQueueStore.getState().clearChat(history.id)

    await restore(history.id, () => {
      useMothershipQueueStore.getState().reopenChat(history.id)
      useMothershipQueueStore.getState().clearChat(history.id)
    })

    expect(takesSends(history.id)).toBe(false)
  })
})
