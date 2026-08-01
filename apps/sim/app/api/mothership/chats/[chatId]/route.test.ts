/**
 * @vitest-environment node
 */
import { copilotHttpMock, copilotHttpMockFns, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { NextRequest } from 'next/server'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockDecrementStorageUsageForBillingContext,
  mockDecrementStorageUsageForBillingContextInTx,
  mockGetAccessibleCopilotChat,
  mockReconcileChatStreamMarkers,
  mockReadEvents,
  mockReadFilePreviewSessions,
  mockGetLatestRunForStream,
} = vi.hoisted(() => ({
  mockDecrementStorageUsageForBillingContext: vi.fn(),
  mockDecrementStorageUsageForBillingContextInTx: vi.fn(),
  mockGetAccessibleCopilotChat: vi.fn(),
  mockReconcileChatStreamMarkers: vi.fn(),
  mockReadEvents: vi.fn(),
  mockReadFilePreviewSessions: vi.fn(),
  mockGetLatestRunForStream: vi.fn(),
}))

vi.mock('@/lib/copilot/request/http', () => copilotHttpMock)

vi.mock('@/lib/copilot/chat/lifecycle', () => ({
  getAccessibleCopilotChatAuth: mockGetAccessibleCopilotChat,
  getAccessibleCopilotChatWithMessages: mockGetAccessibleCopilotChat,
}))

vi.mock('@/lib/copilot/chat/stream-liveness', () => ({
  reconcileChatStreamMarkers: mockReconcileChatStreamMarkers,
}))

vi.mock('@/lib/copilot/request/session/buffer', () => ({
  readEvents: mockReadEvents,
}))

vi.mock('@/lib/copilot/request/session/file-preview-session', () => ({
  readFilePreviewSessions: mockReadFilePreviewSessions,
}))

vi.mock('@/lib/copilot/async-runs/repository', () => ({
  getLatestRunForStream: mockGetLatestRunForStream,
}))

vi.mock('@/lib/copilot/request/session/types', () => ({
  toStreamBatchEvent: (e: unknown) => e,
}))

vi.mock('@/lib/copilot/chat/effective-transcript', () => ({
  buildEffectiveChatTranscript: ({ messages }: { messages: unknown[] }) => messages,
}))

vi.mock('@/lib/copilot/chat/persisted-message', () => ({
  normalizeMessage: (m: unknown) => m,
}))

vi.mock('@/lib/copilot/chat-status', () => ({
  chatPubSub: { publishStatusChanged: vi.fn() },
}))

vi.mock('@/lib/billing/storage', () => ({
  decrementStorageUsageForBillingContext: mockDecrementStorageUsageForBillingContext,
  decrementStorageUsageForBillingContextInTx: mockDecrementStorageUsageForBillingContextInTx,
}))

vi.mock('@/lib/posthog/server', () => ({
  captureServerEvent: vi.fn(),
}))

import { DELETE, GET } from '@/app/api/mothership/chats/[chatId]/route'

function makeContext(chatId: string) {
  return { params: Promise.resolve({ chatId }) }
}

function createRequest(chatId: string) {
  return new NextRequest(`http://localhost:3000/api/mothership/chats/${chatId}`, {
    method: 'GET',
  })
}

afterAll(() => {
  resetDbChainMock()
})

describe('GET /api/mothership/chats/[chatId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

    const response = await GET(createRequest('chat-stuck'), makeContext('chat-stuck'))
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

  it('returns the live activeStreamId with a status-only snapshot (no events)', async () => {
    mockGetAccessibleCopilotChat.mockResolvedValueOnce({
      id: 'chat-live',
      type: 'mothership',
      title: 'Live',
      messages: [],
      resources: [],
      conversationId: 'stream-live',
      createdAt: new Date('2026-05-11T12:00:00Z'),
      updatedAt: new Date('2026-05-11T12:00:00Z'),
    })
    mockGetLatestRunForStream.mockResolvedValueOnce({ status: 'active' })
    const previewSession = {
      id: 'preview-1',
      previewVersion: 1,
      status: 'active',
      updatedAt: '2026-05-11T12:00:00Z',
    }
    mockReadFilePreviewSessions.mockResolvedValueOnce([previewSession])

    const response = await GET(createRequest('chat-live'), makeContext('chat-live'))
    expect(response.status).toBe(200)
    const body = await response.json()

    expect(body.chat.activeStreamId).toBe('stream-live')
    // Events are read only to synthesize the in-flight assistant turn for the
    // initial paint; the client reconnects to the replay buffer for the rest.
    // Status and preview sessions ARE shipped so hydration can gate the
    // reconnect and seed the preview panel before the resume request lands.
    expect(mockReadEvents).toHaveBeenCalledWith('stream-live', '0')
    expect(mockReadFilePreviewSessions).toHaveBeenCalledWith('stream-live')
    expect(body.chat.streamSnapshot).toEqual({
      events: [],
      previewSessions: [previewSession],
      status: 'active',
    })
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

    const response = await GET(createRequest('chat-finished'), makeContext('chat-finished'))
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

    const response = await GET(createRequest('chat-mismatch'), makeContext('chat-mismatch'))
    expect(response.status).toBe(200)
    const body = await response.json()

    expect(body.chat.activeStreamId).toBe('stream-live')
    expect(mockReadEvents).toHaveBeenCalledWith('stream-live', '0')
  })

  it('returns null when the persisted stream marker is already null', async () => {
    mockGetAccessibleCopilotChat.mockResolvedValueOnce({
      id: 'chat-idle',
      type: 'mothership',
      title: 'Idle',
      messages: [],
      resources: [],
      conversationId: null,
      createdAt: new Date('2026-05-11T12:00:00Z'),
      updatedAt: new Date('2026-05-11T12:00:00Z'),
    })

    const response = await GET(createRequest('chat-idle'), makeContext('chat-idle'))
    expect(response.status).toBe(200)

    expect(mockReconcileChatStreamMarkers).toHaveBeenCalledWith(
      [{ chatId: 'chat-idle', streamId: null }],
      { repairVerifiedStaleMarkers: true }
    )
    const body = await response.json()
    expect(body.chat.activeStreamId).toBeNull()
  })

  it('returns 404 when the chat does not exist', async () => {
    mockGetAccessibleCopilotChat.mockResolvedValueOnce(null)

    const response = await GET(createRequest('chat-missing'), makeContext('chat-missing'))
    expect(response.status).toBe(404)
    expect(mockReconcileChatStreamMarkers).not.toHaveBeenCalled()
  })

  it('returns 401 when unauthenticated', async () => {
    copilotHttpMockFns.mockAuthenticateCopilotRequestSessionOnly.mockResolvedValueOnce({
      userId: null,
      isAuthenticated: false,
    })

    const response = await GET(createRequest('chat-x'), makeContext('chat-x'))
    expect(response.status).toBe(401)
    expect(mockGetAccessibleCopilotChat).not.toHaveBeenCalled()
    expect(mockReconcileChatStreamMarkers).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/mothership/chats/[chatId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
      new NextRequest('http://localhost:3000/api/mothership/chats/chat-delete', {
        method: 'DELETE',
      }),
      makeContext('chat-delete')
    )

    expect(response.status).toBe(200)
    expect(dbChainMockFns.update).toHaveBeenCalled()
    expect(dbChainMockFns.set).toHaveBeenCalledWith({ deletedAt: expect.any(Date) })
    expect(mockDecrementStorageUsageForBillingContext).not.toHaveBeenCalled()
    expect(mockDecrementStorageUsageForBillingContextInTx).not.toHaveBeenCalled()
  })
})
