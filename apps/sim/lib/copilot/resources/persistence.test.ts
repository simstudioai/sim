/**
 * @vitest-environment node
 */
import { databaseMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  persistChatResources,
  serializeChatResourceWrite,
} from '@/lib/copilot/resources/persistence'

function deferred() {
  let resolve: () => void = () => {}
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

const transaction = databaseMock.db.transaction as ReturnType<typeof vi.fn>
const TABLE_RESOURCE = { type: 'table' as const, id: 'table-1', title: 'Accounts' }

describe('persistChatResources ordering', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('starts writes for the same chat in invocation order', async () => {
    const first = deferred()
    transaction.mockReturnValueOnce(first.promise).mockResolvedValueOnce(undefined)

    const firstWrite = persistChatResources('chat-1', [{ ...TABLE_RESOURCE, viewId: 'view-a' }])
    const secondWrite = persistChatResources('chat-1', [{ ...TABLE_RESOURCE, viewId: 'view-b' }])
    await vi.waitFor(() => expect(transaction).toHaveBeenCalledTimes(1))
    first.resolve()
    await Promise.all([firstWrite, secondWrite])
    expect(transaction).toHaveBeenCalledTimes(2)
  })

  it('does not serialize writes for different chats', async () => {
    const first = deferred()
    const second = deferred()
    transaction.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)

    const firstWrite = persistChatResources('chat-1', [TABLE_RESOURCE])
    const secondWrite = persistChatResources('chat-2', [TABLE_RESOURCE])
    await vi.waitFor(() => expect(transaction).toHaveBeenCalledTimes(2))
    first.resolve()
    second.resolve()
    await Promise.all([firstWrite, secondWrite])
  })

  it('serializes tool writes behind other resource mutations for the same chat', async () => {
    const apiMutation = deferred()
    const firstWrite = serializeChatResourceWrite('chat-1', () => apiMutation.promise)
    const secondWrite = persistChatResources('chat-1', [TABLE_RESOURCE])

    await Promise.resolve()
    expect(transaction).not.toHaveBeenCalled()
    apiMutation.resolve()
    await Promise.all([firstWrite, secondWrite])

    expect(transaction).toHaveBeenCalledOnce()
  })
})
