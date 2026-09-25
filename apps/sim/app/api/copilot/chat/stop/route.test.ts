/**
 * @vitest-environment node
 */
import { authMockFns, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAppendCopilotChatMessages,
  mockPublishStatusChanged,
  mockGetAccessibleChat,
  mockReadEvents,
} = vi.hoisted(() => ({
  mockGetAccessibleChat: vi.fn(),
  mockAppendCopilotChatMessages: vi.fn(),
  mockPublishStatusChanged: vi.fn(),
  mockReadEvents: vi.fn(),
}))

vi.mock('@/lib/mothership/chat/lifecycle', () => ({
  getAccessibleCopilotChatAuth: mockGetAccessibleChat,
}))
vi.mock('@/lib/mothership/request/session/buffer', () => ({ readEvents: mockReadEvents }))

vi.mock('@/lib/mothership/async-runs/repository', () => ({
  getLatestRunForStream: vi.fn().mockResolvedValue({ chatId: 'chat-1', status: 'cancelled' }),
}))

vi.mock('@/lib/mothership/chat/messages-store', () => ({
  appendCopilotChatMessages: mockAppendCopilotChatMessages,
}))

vi.mock('@/lib/mothership/chat-status', () => ({
  publishChatStatusChanged: mockPublishStatusChanged,
}))

import { getLatestRunForStream } from '@/lib/mothership/async-runs/repository'
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
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: 'user-1' },
      session: { id: 'session-1' },
    })
    mockGetAccessibleChat.mockResolvedValue({ id: 'chat-1', workspaceId: 'ws-1', userId: 'user-1' })
    mockReadEvents.mockResolvedValue([])
  })

  it('does not persist stopped content after organization access is removed', async () => {
    mockGetAccessibleChat.mockResolvedValueOnce(null)
    const response = await POST(
      createRequest({ chatId: 'chat-1', streamId: 'stream-1', content: 'private' })
    )
    expect(response.status).toBe(200)
    expect(dbChainMockFns.transaction).not.toHaveBeenCalled()
    expect(mockAppendCopilotChatMessages).not.toHaveBeenCalled()
  })

  it('preserves task and subagent identity through the partial-response contract', async () => {
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

  it('persists a response larger than the HTTP limit from an identifiers-only Stop', async () => {
    mockReads({
      chat: { workspaceId: 'ws-1', conversationId: 'stream-1', model: null },
      last: { messageId: 'stream-1', role: 'user' },
    })
    const content = 'x'.repeat(11 * 1024 * 1024)
    const envelope = { v: 1, ts: '2026-09-24T19:00:00Z', stream: { streamId: 'stream-1' } }
    mockReadEvents.mockResolvedValue([
      { ...envelope, seq: 1, type: 'text', payload: { channel: 'assistant', text: content } },
      {
        ...envelope,
        seq: 2,
        type: 'tool',
        payload: {
          phase: 'call',
          toolCallId: 'call-1',
          toolName: 'run_code',
          arguments: { code: 'preserve me' },
          status: 'executing',
        },
      },
      { ...envelope, seq: 3, type: 'complete', payload: { status: 'cancelled' } },
    ])
    const request = createRequest({ chatId: 'chat-1', streamId: 'stream-1' })
    expect((await request.clone().text()).length).toBeLessThan(1024)
    const response = await stopRequest(request)
    expect(response.status).toBe(200)
    expect(mockReadEvents).toHaveBeenCalledOnce()
    expect(mockAppendCopilotChatMessages).toHaveBeenCalledOnce()
    const saved = mockAppendCopilotChatMessages.mock.calls[0][1][0]
    expect(saved.content).toBe(content)
    expect(saved.contentBlocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'tool',
          toolCall: expect.objectContaining({
            id: 'call-1',
            state: 'cancelled',
            params: { code: 'preserve me' },
          }),
        }),
        { type: 'complete', status: 'cancelled' },
      ])
    )
    expect(dbChainMockFns.set.mock.calls[0][0].conversationId).toBeNull()
    expect(mockPublishStatusChanged).toHaveBeenCalledOnce()
  })

  it.each(['active', 'other-chat', 'missing'])(
    'does not read replay for an unfinalized or mismatched run: %s',
    async (state) => {
      vi.mocked(getLatestRunForStream).mockResolvedValueOnce(
        state === 'missing'
          ? null
          : ({
              chatId: state === 'other-chat' ? 'other-chat' : 'chat-1',
              status: state === 'active' ? 'active' : 'cancelled',
            } as Awaited<ReturnType<typeof getLatestRunForStream>>)
      )
      const response = await stopRequest(createRequest({ chatId: 'chat-1', streamId: 'stream-1' }))
      expect(response.status).toBe(200)
      expect(getLatestRunForStream).toHaveBeenCalledWith('stream-1', 'user-1')
      expect(mockReadEvents).not.toHaveBeenCalled()
      expect(mockAppendCopilotChatMessages).not.toHaveBeenCalled()
    }
  )

  it('persists completed replay when a late title session event follows completion', async () => {
    mockReads({
      chat: { workspaceId: 'ws-1', conversationId: 'stream-1', model: null },
      last: { messageId: 'stream-1', role: 'user' },
    })
    const envelope = { v: 1, ts: '2026-09-24T19:00:00Z', stream: { streamId: 'stream-1' } }
    mockReadEvents.mockResolvedValue([
      {
        ...envelope,
        seq: 1,
        type: 'text',
        payload: { channel: 'assistant', text: 'Full response' },
      },
      { ...envelope, seq: 2, type: 'complete', payload: { status: 'cancelled' } },
      { ...envelope, seq: 3, type: 'session', payload: { kind: 'title', title: 'New title' } },
    ])
    const response = await stopRequest(createRequest({ chatId: 'chat-1', streamId: 'stream-1' }))
    expect(response.status).toBe(200)
    expect(mockAppendCopilotChatMessages.mock.calls[0][1][0].content).toBe('Full response')
  })

  it('does not finalize a contiguous prefix before the final event is flushed', async () => {
    mockReadEvents.mockResolvedValue([
      {
        v: 1,
        seq: 1,
        ts: '2026-09-24T19:00:00Z',
        stream: { streamId: 'stream-1' },
        type: 'text',
        payload: { channel: 'assistant', text: 'incomplete prefix' },
      },
    ])
    const response = await stopRequest(createRequest({ chatId: 'chat-1', streamId: 'stream-1' }))
    expect(response.status).toBe(200)
    expect(mockAppendCopilotChatMessages).not.toHaveBeenCalled()
    expect(dbChainMockFns.set).not.toHaveBeenCalled()
  })

  it.each([{ seqs: [] }, { seqs: [2, 3] }, { seqs: [1, 3] }])(
    'leaves incomplete replay $seqs to the run owner without erasing its response',
    async ({ seqs }) => {
      mockReadEvents.mockResolvedValue(
        seqs.map((seq) => ({
          v: 1,
          seq,
          ts: '2026-09-24T19:00:00Z',
          stream: { streamId: 'stream-1' },
          type: 'text',
          payload: { channel: 'assistant', text: 'tail only' },
        }))
      )
      const response = await stopRequest(createRequest({ chatId: 'chat-1', streamId: 'stream-1' }))
      expect(response.status).toBe(200)
      expect(mockAppendCopilotChatMessages).not.toHaveBeenCalled()
      expect(dbChainMockFns.set).not.toHaveBeenCalled()
      expect(mockPublishStatusChanged).not.toHaveBeenCalled()
    }
  )

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

    expect(mockPublishStatusChanged).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws-1' }),
      {
        chatId: 'chat-1',
        type: 'completed',
        streamId: 'stream-1',
      }
    )
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
    expect(mockPublishStatusChanged).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws-1' }),
      {
        chatId: 'chat-1',
        type: 'completed',
        streamId: 'stream-1',
      }
    )
  })
})
