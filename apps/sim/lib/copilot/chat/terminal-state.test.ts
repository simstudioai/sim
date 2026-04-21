/**
 * @vitest-environment node
 */

import { copilotChats } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { selectLimit, selectWhere, selectFrom, select, updateWhere, updateSet, update } = vi.hoisted(
  () => {
    const selectLimit = vi.fn()
    const selectWhere = vi.fn(() => ({ limit: selectLimit }))
    const selectFrom = vi.fn(() => ({ where: selectWhere }))
    const select = vi.fn(() => ({ from: selectFrom }))

    const updateWhere = vi.fn()
    const updateSet = vi.fn(() => ({ where: updateWhere }))
    const update = vi.fn(() => ({ set: updateSet }))

    return {
      selectLimit,
      selectWhere,
      selectFrom,
      select,
      updateWhere,
      updateSet,
      update,
    }
  }
)

vi.mock('@sim/db', () => ({
  db: {
    select,
    update,
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
    expect(updateWhere).toHaveBeenCalledWith(
      and(eq(copilotChats.id, 'chat-1'), eq(copilotChats.conversationId, 'user-1'))
    )
  })

  it('only clears the active stream marker when a response is already persisted', async () => {
    selectLimit.mockResolvedValue([
      {
        messages: [
          { id: 'user-1', role: 'user', content: 'hello' },
          { id: 'assistant-1', role: 'assistant', content: 'partial' },
        ],
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
    expect(updateWhere).toHaveBeenCalledWith(
      and(eq(copilotChats.id, 'chat-1'), eq(copilotChats.conversationId, 'user-1'))
    )
  })
})
