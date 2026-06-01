/**
 * @vitest-environment node
 */

import { copilotChats } from '@sim/db/schema'
import { dbChainMock, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/db', () => dbChainMock)

const { mockAppendCopilotChatMessages } = vi.hoisted(() => ({
  mockAppendCopilotChatMessages: vi.fn(),
}))

vi.mock('@/lib/copilot/chat/messages-store', () => ({
  appendCopilotChatMessages: mockAppendCopilotChatMessages,
}))

import { finalizeAssistantTurn } from './terminal-state'

const assistantMessage = {
  id: 'assistant-1',
  role: 'assistant' as const,
  content: 'hi',
  timestamp: '2024-01-01T00:00:00.000Z',
}

/**
 * Sequence the two in-tx reads: the chat row (`FOR UPDATE ... LIMIT 1`) and the
 * last-message lookup that drives dedup — both terminate on `.limit(1)`.
 */
function mockReads(opts: {
  chat: Record<string, unknown> | null
  last?: { messageId: string; role: string }
}) {
  dbChainMockFns.limit.mockResolvedValueOnce(opts.chat ? [opts.chat] : [])
  dbChainMockFns.limit.mockResolvedValueOnce(opts.last ? [opts.last] : [])
}

describe('finalizeAssistantTurn', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Drain the once-queue (clearAllMocks/resetDbChainMock don't), then restore defaults.
    dbChainMockFns.limit.mockReset()
    resetDbChainMock()
  })

  it('appends the assistant message when the user turn has no reply yet', async () => {
    mockReads({
      chat: { conversationId: 'user-1', workspaceId: 'ws-1', model: null },
      last: { messageId: 'user-1', role: 'user' },
    })

    const result = await finalizeAssistantTurn({
      chatId: 'chat-1',
      userMessageId: 'user-1',
      assistantMessage,
    })

    expect(result.appendedAssistant).toBe(true)
    const updateArg = dbChainMockFns.set.mock.calls[0]?.[0] as Record<string, unknown>
    expect(updateArg).toEqual(
      expect.objectContaining({ updatedAt: expect.any(Date), conversationId: null })
    )
    expect(Object.hasOwn(updateArg, 'messages')).toBe(false)
    expect(dbChainMockFns.where).toHaveBeenCalledWith(eq(copilotChats.id, 'chat-1'))
    expect(mockAppendCopilotChatMessages).toHaveBeenCalledTimes(1)
    expect(mockAppendCopilotChatMessages).toHaveBeenCalledWith(
      'chat-1',
      [assistantMessage],
      { streamId: 'user-1', chatModel: null },
      expect.anything()
    )
  })

  it('only clears the active stream marker when a response is already persisted', async () => {
    mockReads({
      chat: { conversationId: 'user-1', workspaceId: 'ws-1', model: null },
      last: { messageId: 'assistant-1', role: 'assistant' },
    })

    const result = await finalizeAssistantTurn({
      chatId: 'chat-1',
      userMessageId: 'user-1',
      assistantMessage: { ...assistantMessage, id: 'assistant-2' },
    })

    expect(result.outcome).toBe('assistant_already_persisted')
    const updateArg = dbChainMockFns.set.mock.calls[0]?.[0] as Record<string, unknown>
    expect(updateArg).toEqual(
      expect.objectContaining({ updatedAt: expect.any(Date), conversationId: null })
    )
    expect(Object.hasOwn(updateArg, 'messages')).toBe(false)
    expect(mockAppendCopilotChatMessages).not.toHaveBeenCalled()
  })

  it('appends a stopped assistant when the stream marker was already cleared', async () => {
    mockReads({
      chat: { conversationId: null, workspaceId: 'ws-1', model: null },
      last: { messageId: 'user-1', role: 'user' },
    })

    const result = await finalizeAssistantTurn({
      chatId: 'chat-1',
      userMessageId: 'user-1',
      streamMarkerPolicy: 'active-or-cleared',
      assistantMessage,
    })

    expect(result.appendedAssistant).toBe(true)
    expect(mockAppendCopilotChatMessages).toHaveBeenCalledTimes(1)
  })

  it('does not append on a cleared marker unless the policy allows it', async () => {
    mockReads({ chat: { conversationId: null, workspaceId: 'ws-1', model: null } })

    const result = await finalizeAssistantTurn({
      chatId: 'chat-1',
      userMessageId: 'user-1',
      assistantMessage,
    })

    expect(result.updated).toBe(false)
    expect(dbChainMockFns.set).not.toHaveBeenCalled()
    expect(mockAppendCopilotChatMessages).not.toHaveBeenCalled()
  })

  it('reports already persisted when a cleared marker races with a duplicate stop', async () => {
    mockReads({
      chat: { conversationId: null, workspaceId: 'ws-1', model: null },
      last: { messageId: 'assistant-1', role: 'assistant' },
    })

    const result = await finalizeAssistantTurn({
      chatId: 'chat-1',
      userMessageId: 'user-1',
      streamMarkerPolicy: 'active-or-cleared',
      assistantMessage: { ...assistantMessage, id: 'assistant-2' },
    })

    expect(result.updated).toBe(false)
    expect(result.outcome).toBe('assistant_already_persisted')
    expect(dbChainMockFns.set).not.toHaveBeenCalled()
    expect(mockAppendCopilotChatMessages).not.toHaveBeenCalled()
  })
})
