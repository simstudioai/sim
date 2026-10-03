import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { createRouteContext } from '@sim/testing/helpers/http'
import { billingStorageMock, billingStorageMockFns } from '@sim/testing/mocks/billing-storage.mock'
import { copilotHttpMock, copilotHttpMockFns } from '@sim/testing/mocks/copilot-http.mock'
import { dbChainMockFns, resetDbChainMock } from '@sim/testing/mocks/database.mock'
import {
  mothershipAsyncRunsMock,
  mothershipAsyncRunsMockFns,
} from '@sim/testing/mocks/mothership-async-runs.mock'
import {
  mothershipChatLifecycleMock,
  mothershipChatLifecycleMockFns,
} from '@sim/testing/mocks/mothership-chat-lifecycle.mock'
import { mothershipChatStatusMock } from '@sim/testing/mocks/mothership-chat-status.mock'
import { posthogServerMock } from '@sim/testing/mocks/posthog-server.mock'
import { createMockRequest } from '@sim/testing/mocks/request.mock'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockReconcileChatStreamMarkers, mockReadEvents, mockReadFilePreviewSessions } = vi.hoisted(
  () => ({
    mockReconcileChatStreamMarkers: vi.fn(),
    mockReadEvents: vi.fn(),
    mockReadFilePreviewSessions: vi.fn(),
  })
)

vi.mock('@/lib/mothership/request/http', () => copilotHttpMock)

vi.mock('@/lib/mothership/chat/lifecycle', () => mothershipChatLifecycleMock)

vi.mock('@/lib/mothership/chat/stream-liveness', () => ({
  reconcileChatStreamMarkers: mockReconcileChatStreamMarkers,
}))

vi.mock('@/lib/mothership/request/session/buffer', () => ({
  readEvents: mockReadEvents,
}))

vi.mock('@/lib/mothership/request/session/file-preview-session', () => ({
  readFilePreviewSessions: mockReadFilePreviewSessions,
}))

vi.mock('@/lib/mothership/async-runs/repository', () => mothershipAsyncRunsMock)

vi.mock('@/lib/mothership/chat-status', () => mothershipChatStatusMock)

vi.mock('@/lib/billing/storage', () => billingStorageMock)

vi.mock('@/lib/posthog/server', () => posthogServerMock)

import { publishChatStatusChanged } from '@/lib/mothership/chat-status'
import { DELETE, GET, PATCH } from '@/app/api/mothership/chats/[chatId]/route'

const { mockGetAccessibleCopilotChatAuth: mockGetAccessibleCopilotChat } =
  mothershipChatLifecycleMockFns
mothershipChatLifecycleMockFns.mockGetAccessibleCopilotChatWithMessages.mockImplementation(
  (...args: Parameters<typeof mockGetAccessibleCopilotChat>) =>
    mockGetAccessibleCopilotChat(...args)
)
const { mockGetLatestRunForStream } = mothershipAsyncRunsMockFns
const { mockDecrementStorageUsageForBillingContextInTx } = billingStorageMockFns

function createRequest(chatId: string) {
  return createMockRequest({ url: `http://localhost:3000/api/mothership/chats/${chatId}` })
}

afterAll(() => {
  resetDbChainMock()
})

describe('GET /api/mothership/chats/[chatId]', () => {
  beforeEach(() => {
    resetDbChainMock()
    copilotHttpMockFns.mockAuthenticateCopilotRequestSessionOnly.mockResolvedValue({
      userId: 'user-1',
      isAuthenticated: true,
    })
    mockReconcileChatStreamMarkers.mockImplementation(
      async (candidates: Array<{ chatId: string; streamId: string | null }>) =>
        new Map(
          candidates.map((candidate) => [
            candidate.chatId,
            {
              chatId: candidate.chatId,
              streamId: candidate.streamId,
              status: candidate.streamId ? 'active' : 'inactive',
            },
          ])
        )
    )
    mockReadEvents.mockResolvedValue([])
    mockReadFilePreviewSessions.mockResolvedValue([])
    mockGetLatestRunForStream.mockResolvedValue(null)
  })

  it.each(['active', 'complete'] as const)(
    'returns watch history through the real transcript projection for a %s stream',
    async (status) => {
      mockGetAccessibleCopilotChat.mockResolvedValueOnce({
        id: 'chat-watch',
        type: 'mothership',
        title: 'Watch',
        messages: [
          {
            id: 'stream-watch',
            role: 'user',
            content: 'Watch the report',
            timestamp: '2026-09-06T12:00:00Z',
          },
        ],
        resources: [],
        conversationId: 'stream-watch',
        createdAt: new Date('2026-09-06T12:00:00Z'),
        updatedAt: new Date('2026-09-06T12:00:00Z'),
      })
      mockGetLatestRunForStream.mockResolvedValueOnce({ status })
      mockReadEvents.mockResolvedValueOnce([
        {
          v: 1,
          type: 'run',
          seq: 1,
          ts: '2026-09-06T12:00:01Z',
          stream: { streamId: 'stream-watch' },
          payload: {
            kind: 'task_armed',
            taskId: 'task-1',
            taskKind: 'timer',
            target: { firesAt: '2026-09-06T12:01:00Z' },
            note: 'Check report',
          },
        },
        ...(status === 'complete'
          ? [
              {
                v: 1,
                type: 'run',
                seq: 2,
                ts: '2026-09-06T12:01:00Z',
                stream: { streamId: 'stream-watch' },
                payload: {
                  kind: 'task_delivered',
                  taskId: 'task-1',
                  status: 'completed',
                  summary: 'Timer elapsed',
                },
              },
            ]
          : []),
      ])
      const response = await GET(
        createRequest('chat-watch'),
        createRouteContext({ chatId: 'chat-watch' })
      )
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.chat.messages).toHaveLength(2)
      expect(body.chat.messages[1].contentBlocks).toEqual([
        expect.objectContaining({
          type: 'task',
          task: expect.objectContaining({
            taskId: 'task-1',
            kind: 'timer',
            note: 'Check report',
            status: status === 'active' ? 'pending' : 'completed',
            ...(status === 'complete' ? { summary: 'Timer elapsed' } : {}),
          }),
        }),
      ])
      expect(body.chat.streamSnapshot).toEqual({ events: [], previewSessions: [], status })
    }
  )

  it('clears activeStreamId when the redis lock has expired (stuck-yellow bug)', async () => {
    mockGetAccessibleCopilotChat.mockResolvedValueOnce({
      id: 'chat-stuck',
      type: 'mothership',
      title: 'Stuck',
      messages: [],
      resources: [],
      conversationId: 'stream-orphaned',
      createdAt: new Date('2026-05-11T12:00:00Z'),
      updatedAt: new Date('2026-05-11T12:00:00Z'),
    })
    mockReconcileChatStreamMarkers.mockResolvedValueOnce(
      new Map([['chat-stuck', { chatId: 'chat-stuck', streamId: null, status: 'inactive' }]])
    )

    const response = await GET(
      createRequest('chat-stuck'),
      createRouteContext({ chatId: 'chat-stuck' })
    )
    expect(response.status).toBe(200)
    const body = await response.json()

    expect(mockReconcileChatStreamMarkers).toHaveBeenCalledWith(
      [{ chatId: 'chat-stuck', streamId: 'stream-orphaned' }],
      { repairVerifiedStaleMarkers: true }
    )
    expect(body.success).toBe(true)
    expect(body.chat.activeStreamId).toBeNull()
    expect(body.chat.streamSnapshot).toBeUndefined()
    expect(mockReadEvents).not.toHaveBeenCalled()
  })

  it('reports a terminal run status when the stream lock is still visible', async () => {
    mockGetAccessibleCopilotChat.mockResolvedValueOnce({
      id: 'chat-finished',
      type: 'mothership',
      title: 'Finished',
      messages: [],
      resources: [],
      conversationId: 'stream-finished',
      createdAt: new Date('2026-05-11T12:00:00Z'),
      updatedAt: new Date('2026-05-11T12:00:00Z'),
    })
    mockGetLatestRunForStream.mockResolvedValueOnce({ status: 'complete' })

    const response = await GET(
      createRequest('chat-finished'),
      createRouteContext({ chatId: 'chat-finished' })
    )
    expect(response.status).toBe(200)
    const body = await response.json()

    // The run finished but the Redis lock hasn't cleared yet: the client
    // must see the terminal status so it skips the reconnect entirely.
    expect(body.chat.activeStreamId).toBe('stream-finished')
    expect(body.chat.streamSnapshot).toEqual({
      events: [],
      previewSessions: [],
      status: 'complete',
    })
  })

  it('uses the Redis lock owner when it differs from a stale persisted streamId', async () => {
    mockGetAccessibleCopilotChat.mockResolvedValueOnce({
      id: 'chat-mismatch',
      type: 'mothership',
      title: 'Mismatch',
      messages: [],
      resources: [],
      conversationId: 'stream-stale',
      createdAt: new Date('2026-05-11T12:00:00Z'),
      updatedAt: new Date('2026-05-11T12:00:00Z'),
    })
    mockReconcileChatStreamMarkers.mockResolvedValueOnce(
      new Map([
        ['chat-mismatch', { chatId: 'chat-mismatch', streamId: 'stream-live', status: 'active' }],
      ])
    )

    const response = await GET(
      createRequest('chat-mismatch'),
      createRouteContext({ chatId: 'chat-mismatch' })
    )
    expect(response.status).toBe(200)
    const body = await response.json()

    expect(body.chat.activeStreamId).toBe('stream-live')
    expect(mockReadEvents).toHaveBeenCalledWith('stream-live', '0')
  })
})

describe('DELETE /api/mothership/chats/[chatId]', () => {
  beforeEach(() => {
    resetDbChainMock()
    copilotHttpMockFns.mockAuthenticateCopilotRequestSessionOnly.mockResolvedValue({
      userId: 'user-1',
      isAuthenticated: true,
    })
    mockGetAccessibleCopilotChat.mockResolvedValue({
      id: 'chat-delete',
      type: 'mothership',
      workspaceId: 'workspace-1',
    })
    dbChainMockFns.returning.mockResolvedValue([{ workspaceId: 'workspace-1' }])
  })

  it('soft-deletes an unbilled chat without decrementing workspace or payer storage', async () => {
    const response = await DELETE(
      createMockRequest({
        method: 'DELETE',
        url: 'http://localhost:3000/api/mothership/chats/chat-delete',
      }),
      createRouteContext({ chatId: 'chat-delete' })
    )

    expect(response.status).toBe(200)
    expect(dbChainMockFns.update).toHaveBeenCalled()
    expect(dbChainMockFns.set).toHaveBeenCalledWith({ deletedAt: expect.any(Date) })
    expect(mockDecrementStorageUsageForBillingContextInTx).not.toHaveBeenCalled()
  })
})

describe('organization chat mutations publish private owner updates', () => {
  beforeEach(() => {
    resetDbChainMock()
    copilotHttpMockFns.mockAuthenticateCopilotRequestSessionOnly.mockResolvedValue({
      userId: 'user-1',
      isAuthenticated: true,
      principal: createSessionPrincipal(),
    })
    mockGetAccessibleCopilotChat.mockResolvedValue({
      id: 'chat-1',
      type: 'mothership',
      organizationId: 'org-1',
      userId: 'user-1',
    })
    dbChainMockFns.returning.mockResolvedValue([
      { id: 'chat-1', workspaceId: null, organizationId: 'org-1' },
    ])
  })

  it('does not publish if a concurrent deletion leaves no updated row', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([])
    const response = await PATCH(
      createMockRequest({
        method: 'PATCH',
        url: 'http://localhost/api/mothership/chats/chat-1',
        body: { pinned: true },
      }),
      createRouteContext({ chatId: 'chat-1' })
    )
    expect(response.status).toBe(404)
    expect(publishChatStatusChanged).not.toHaveBeenCalled()
  })
})
