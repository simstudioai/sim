/**
 * @vitest-environment node
 */
import { authMockFns, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockAppendCopilotChatMessages, mockPublishStatusChanged } = vi.hoisted(() => ({
  mockAppendCopilotChatMessages: vi.fn(),
  mockPublishStatusChanged: vi.fn(),
}))

vi.mock('@/lib/mothership/chat/messages-store', () => ({
  appendCopilotChatMessages: mockAppendCopilotChatMessages,
}))

vi.mock('@/lib/mothership/chat-status', () => ({
  chatPubSub: {
    publishStatusChanged: mockPublishStatusChanged,
  },
}))

import { POST } from '@/app/api/copilot/chat/stop/route'

const stopRequest = (request: NextRequest) => POST(request, undefined)

function createRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost:3000/api/copilot/chat/stop', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Sequence the two in-tx reads `finalizeAssistantTurn` issues: the chat row
 * (`FOR UPDATE ... LIMIT 1`) and the last-message lookup that drives dedup
 * (both terminate on `.limit(1)`).
 */
function mockReads(opts: {
  chat: Record<string, unknown> | null
  last?: { messageId: string; role: string }
}) {
  dbChainMockFns.limit.mockResolvedValueOnce(opts.chat ? [opts.chat] : [])
  dbChainMockFns.limit.mockResolvedValueOnce(opts.last ? [opts.last] : [])
}

describe('copilot chat stop route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Drain the once-queue (clearAllMocks/resetDbChainMock don't), then restore defaults.
    dbChainMockFns.limit.mockReset()
    resetDbChainMock()
    authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
  })

  it('preserves task, plan and subagent identity through the partial-response contract', async () => {
    mockReads({
      chat: { workspaceId: 'ws-1', conversationId: 'stream-1', model: null },
      last: { messageId: 'stream-1', role: 'user' },
    })
    const blocks = [
      {
        type: 'task',
        task: {
          taskId: 'watch-1',
          kind: 'workflow_run',
          status: 'pending',
          target: { workflowId: 'workflow-1', executionId: 'execution-1' },
          note: 'Watch invoice run',
        },
      },
      { type: 'plan', planItems: [{ step: 'Check the result', status: 'active' }] },
      {
        type: 'span',
        kind: 'subagent',
        lifecycle: 'end',
        name: 'Investigate invoices',
        error: 'Lookup interrupted',
        spanId: 'child-span',
        parentSpanId: 'main',
        parentToolCallId: 'task-call',
      },
      {
        type: 'text',
        lane: 'subagent',
        agent: 'Investigate invoices',
        channel: 'assistant',
        content: 'Found the relevant run.',
        spanId: 'child-span',
        parentSpanId: 'main',
        parentToolCallId: 'task-call',
      },
    ]
    const response = await stopRequest(
      createRequest({ chatId: 'chat-1', streamId: 'stream-1', content: '', contentBlocks: blocks })
    )
    expect(response.status).toBe(200)
    expect(mockAppendCopilotChatMessages).toHaveBeenCalledOnce()
    const [, appended] = mockAppendCopilotChatMessages.mock.calls[0]
    expect(appended[0].contentBlocks).toEqual(expect.arrayContaining(blocks))
  })

  it('returns 401 when unauthenticated', async () => {
    authMockFns.mockGetSession.mockResolvedValueOnce(null)

    const response = await stopRequest(
      createRequest({ chatId: 'chat-1', streamId: 'stream-1', content: '' })
    )

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Unauthorized' })
  })

  it('is a no-op when the chat is missing', async () => {
    mockReads({ chat: null })

    const response = await stopRequest(
      createRequest({ chatId: 'missing-chat', streamId: 'stream-1', content: '' })
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true })
    expect(mockAppendCopilotChatMessages).not.toHaveBeenCalled()
  })

  it('appends a stopped assistant message even with no content', async () => {
    mockReads({
      chat: { workspaceId: 'ws-1', conversationId: 'stream-1', model: null },
      last: { messageId: 'stream-1', role: 'user' },
    })

    const response = await stopRequest(
      createRequest({ chatId: 'chat-1', streamId: 'stream-1', content: '' })
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true })

    const setArg = dbChainMockFns.set.mock.calls[0]?.[0] as Record<string, unknown>
    expect(setArg.conversationId).toBeNull()
    expect(Object.hasOwn(setArg, 'messages')).toBe(false)

    expect(mockAppendCopilotChatMessages).toHaveBeenCalledTimes(1)
    const [, appended] = mockAppendCopilotChatMessages.mock.calls[0]
    expect(appended[0]).toMatchObject({
      role: 'assistant',
      content: '',
      contentBlocks: [{ type: 'complete', status: 'cancelled' }],
    })

    expect(mockPublishStatusChanged).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      chatId: 'chat-1',
      type: 'completed',
      streamId: 'stream-1',
    })
  })

  it('appends a stopped assistant message if the stream marker was already cleared', async () => {
    mockReads({
      chat: { workspaceId: 'ws-1', conversationId: null, model: null },
      last: { messageId: 'stream-1', role: 'user' },
    })

    const response = await stopRequest(
      createRequest({ chatId: 'chat-1', streamId: 'stream-1', content: 'partial' })
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true })

    expect(mockAppendCopilotChatMessages).toHaveBeenCalledTimes(1)
    const [, appended] = mockAppendCopilotChatMessages.mock.calls[0]
    expect(appended[0]).toMatchObject({ role: 'assistant', content: 'partial' })

    expect(mockPublishStatusChanged).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      chatId: 'chat-1',
      type: 'completed',
      streamId: 'stream-1',
    })
  })

  it('republishes completed status when the assistant was already persisted', async () => {
    mockReads({
      chat: { workspaceId: 'ws-1', conversationId: null, model: null },
      last: { messageId: 'assistant-1', role: 'assistant' },
    })

    const response = await stopRequest(
      createRequest({ chatId: 'chat-1', streamId: 'stream-1', content: 'partial' })
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true })
    expect(mockAppendCopilotChatMessages).not.toHaveBeenCalled()
    expect(dbChainMockFns.set).not.toHaveBeenCalled()
    expect(mockPublishStatusChanged).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      chatId: 'chat-1',
      type: 'completed',
      streamId: 'stream-1',
    })
  })
})
