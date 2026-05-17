/**
 * @vitest-environment node
 */

import { copilotChats } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  selectForUpdate,
  selectLimit,
  selectWhere,
  selectFrom,
  select,
  updateWhere,
  updateSet,
  update,
  transaction,
} = vi.hoisted(() => {
  const selectLimit = vi.fn()
  const selectForUpdate = vi.fn(() => ({ limit: selectLimit }))
  const selectWhere = vi.fn(() => ({ for: selectForUpdate }))
  const selectFrom = vi.fn(() => ({ where: selectWhere }))
  const select = vi.fn(() => ({ from: selectFrom }))

  const updateWhere = vi.fn()
  const updateSet = vi.fn(() => ({ where: updateWhere }))
  const update = vi.fn(() => ({ set: updateSet }))

  const transaction = vi.fn(
    (callback: (tx: { select: typeof select; update: typeof update }) => unknown) =>
      callback({ select, update })
  )

  return {
    selectForUpdate,
    selectLimit,
    selectWhere,
    selectFrom,
    select,
    updateWhere,
    updateSet,
    update,
    transaction,
  }
})

vi.mock('@sim/db', () => ({
  db: {
    transaction,
  },
}))

import { finalizeAssistantTurn } from './terminal-state'

describe('finalizeAssistantTurn', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    updateWhere.mockResolvedValue(undefined)
  })

  it('appends the assistant message when the user turn is still last', async () => {
    selectLimit.mockResolvedValue([
      {
        messages: [{ id: 'user-1', role: 'user', content: 'hello' }],
        conversationId: 'user-1',
        workspaceId: 'ws-1',
      },
    ])

    await finalizeAssistantTurn({
      chatId: 'chat-1',
      userMessageId: 'user-1',
      assistantMessage: {
        id: 'assistant-1',
        role: 'assistant',
        content: 'hi',
        timestamp: '2024-01-01T00:00:00.000Z',
      },
    })

    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        updatedAt: expect.any(Date),
        conversationId: null,
        messages: expect.anything(),
      })
    )
    expect(updateWhere).toHaveBeenCalledWith(eq(copilotChats.id, 'chat-1'))
  })

  it('only clears the active stream marker when a response is already persisted', async () => {
    selectLimit.mockResolvedValue([
      {
        messages: [
          { id: 'user-1', role: 'user', content: 'hello' },
          { id: 'assistant-1', role: 'assistant', content: 'partial' },
        ],
        conversationId: 'user-1',
        workspaceId: 'ws-1',
      },
    ])

    await finalizeAssistantTurn({
      chatId: 'chat-1',
      userMessageId: 'user-1',
      assistantMessage: {
        id: 'assistant-2',
        role: 'assistant',
        content: 'final',
        timestamp: '2024-01-01T00:00:00.000Z',
      },
    })

    const updateCalls = updateSet.mock.calls as unknown as Array<[Record<string, unknown>]>
    const updateArg = updateCalls[0]?.[0]
    expect(updateArg).toBeDefined()
    if (!updateArg) {
      throw new Error('Expected updateSet to be called')
    }
    expect(updateArg).toEqual(
      expect.objectContaining({
        updatedAt: expect.any(Date),
        conversationId: null,
      })
    )
    expect(Object.hasOwn(updateArg, 'messages')).toBe(false)
    expect(updateWhere).toHaveBeenCalledWith(eq(copilotChats.id, 'chat-1'))
  })

  it('appends a stopped assistant when the stream marker was already cleared', async () => {
    selectLimit.mockResolvedValue([
      {
        messages: [{ id: 'user-1', role: 'user', content: 'hello' }],
        conversationId: null,
        workspaceId: 'ws-1',
      },
    ])

    const result = await finalizeAssistantTurn({
      chatId: 'chat-1',
      userMessageId: 'user-1',
      streamMarkerPolicy: 'active-or-cleared',
      assistantMessage: {
        id: 'assistant-1',
        role: 'assistant',
        content: 'partial',
        timestamp: '2024-01-01T00:00:00.000Z',
      },
    })

    expect(result.appendedAssistant).toBe(true)
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        updatedAt: expect.any(Date),
        conversationId: null,
        messages: expect.anything(),
      })
    )
  })

  it('does not append on a cleared marker unless the policy allows it', async () => {
    selectLimit.mockResolvedValue([
      {
        messages: [{ id: 'user-1', role: 'user', content: 'hello' }],
        conversationId: null,
        workspaceId: 'ws-1',
      },
    ])

    const result = await finalizeAssistantTurn({
      chatId: 'chat-1',
      userMessageId: 'user-1',
      assistantMessage: {
        id: 'assistant-1',
        role: 'assistant',
        content: 'partial',
        timestamp: '2024-01-01T00:00:00.000Z',
      },
    })

    expect(result.updated).toBe(false)
    expect(updateSet).not.toHaveBeenCalled()
  })

  it('reports already persisted when a cleared marker races with a duplicate stop', async () => {
    selectLimit.mockResolvedValue([
      {
        messages: [
          { id: 'user-1', role: 'user', content: 'hello' },
          { id: 'assistant-1', role: 'assistant', content: 'partial' },
        ],
        conversationId: null,
        workspaceId: 'ws-1',
      },
    ])

    const result = await finalizeAssistantTurn({
      chatId: 'chat-1',
      userMessageId: 'user-1',
      streamMarkerPolicy: 'active-or-cleared',
      assistantMessage: {
        id: 'assistant-2',
        role: 'assistant',
        content: 'partial',
        timestamp: '2024-01-01T00:00:00.000Z',
      },
    })

    expect(result.updated).toBe(false)
    expect(result.outcome).toBe('assistant_already_persisted')
    expect(updateSet).not.toHaveBeenCalled()
  })
})
