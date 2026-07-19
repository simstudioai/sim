/**
 * @vitest-environment node
 */
import { copilotHttpMock, copilotHttpMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockDbDelete,
  mockDbReturning,
  mockDbWhere,
  mockDecrementStorageUsageForBillingContext,
  mockDecrementStorageUsageForBillingContextInTx,
  mockGetAccessibleCopilotChat,
  mockReconcileChatStreamMarkers,
  mockReadEvents,
  mockReadFilePreviewSessions,
  mockGetLatestRunForStream,
  mockGetLinkedAppProjectForChat,
  mockLoadFullstackLifecycle,
} = vi.hoisted(() => ({
  mockDbDelete: vi.fn(),
  mockDbReturning: vi.fn(),
  mockDbWhere: vi.fn(),
  mockDecrementStorageUsageForBillingContext: vi.fn(),
  mockDecrementStorageUsageForBillingContextInTx: vi.fn(),
  mockGetAccessibleCopilotChat: vi.fn(),
  mockReconcileChatStreamMarkers: vi.fn(),
  mockReadEvents: vi.fn(),
  mockReadFilePreviewSessions: vi.fn(),
  mockGetLatestRunForStream: vi.fn(),
  mockGetLinkedAppProjectForChat: vi.fn(),
  mockLoadFullstackLifecycle: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: {
    delete: mockDbDelete,
  },
}))

vi.mock('@sim/db/schema', () => ({
  appProject: {
    id: 'appProject.id',
    workspaceId: 'appProject.workspaceId',
    archivedAt: 'appProject.archivedAt',
    lastBuilderChatId: 'appProject.lastBuilderChatId',
    createdFromChatId: 'appProject.createdFromChatId',
    updatedAt: 'appProject.updatedAt',
  },
  copilotChats: {
    id: 'copilotChats.id',
    userId: 'copilotChats.userId',
    type: 'copilotChats.type',
    updatedAt: 'copilotChats.updatedAt',
    lastSeenAt: 'copilotChats.lastSeenAt',
    workspaceId: 'copilotChats.workspaceId',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => ({ type: 'and', conditions })),
  desc: vi.fn((field: unknown) => ({ type: 'desc', field })),
  eq: vi.fn((field: unknown, value: unknown) => ({ type: 'eq', field, value })),
  inArray: vi.fn((field: unknown, values: unknown[]) => ({ type: 'inArray', field, values })),
  isNull: vi.fn((field: unknown) => ({ type: 'isNull', field })),
  or: vi.fn((...conditions: unknown[]) => ({ type: 'or', conditions })),
  sql: Object.assign(
    vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
      type: 'sql',
      strings,
      values,
    })),
    { raw: vi.fn() }
  ),
}))

vi.mock('@/lib/copilot/request/http', () => copilotHttpMock)

vi.mock('@/lib/apps/demo/lifecycle-state', () => ({
  loadFullstackDemoLifecycleSummary: mockLoadFullstackLifecycle,
}))

vi.mock('@/lib/apps/projects', () => ({
  getLinkedAppProjectForChat: mockGetLinkedAppProjectForChat,
}))

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

describe('GET /api/mothership/chats/[chatId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
    mockGetLinkedAppProjectForChat.mockResolvedValue(null)
    mockLoadFullstackLifecycle.mockResolvedValue(null)
  })

  it('hydrates a completed Full-stack credential pause from chat config', async () => {
    const lifecycle = {
      version: 1,
      status: 'credential_selection_required',
      phase: 'credential_selection_required',
      chatId: 'chat-fullstack',
      projectId: 'project-1',
      originalPrompt: 'Build an app',
      workflowIds: ['wf-1'],
      credentialSelections: [],
      updatedAt: '2026-07-18T00:00:00.000Z',
    }
    mockGetAccessibleCopilotChat.mockResolvedValueOnce({
      id: 'chat-fullstack',
      type: 'fullstack',
      title: 'App',
      messages: [],
      resources: [],
      conversationId: null,
      workspaceId: 'ws-1',
      createdAt: new Date('2026-07-18T00:00:00.000Z'),
      updatedAt: new Date('2026-07-18T00:00:00.000Z'),
    })
    mockLoadFullstackLifecycle.mockResolvedValueOnce(lifecycle)

    const response = await GET(createRequest('chat-fullstack'), makeContext('chat-fullstack'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.chat.fullstackLifecycle).toEqual(lifecycle)
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

  it('returns the live activeStreamId when redis confirms the lock', async () => {
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

    const response = await GET(createRequest('chat-live'), makeContext('chat-live'))
    expect(response.status).toBe(200)
    const body = await response.json()

    expect(body.chat.activeStreamId).toBe('stream-live')
    expect(mockReadEvents).toHaveBeenCalledWith('stream-live', '0')
    expect(body.chat.streamSnapshot).toBeDefined()
    expect(body.chat.streamSnapshot.status).toBe('active')
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
    copilotHttpMockFns.mockAuthenticateCopilotRequestSessionOnly.mockResolvedValue({
      userId: 'user-1',
      isAuthenticated: true,
    })
    mockGetAccessibleCopilotChat.mockResolvedValue({
      id: 'chat-delete',
      type: 'mothership',
      workspaceId: 'workspace-1',
    })
    mockDbDelete.mockReturnValue({ where: mockDbWhere })
    mockDbWhere.mockReturnValue({ returning: mockDbReturning })
    mockDbReturning.mockResolvedValue([{ workspaceId: 'workspace-1' }])
  })

  it('deletes an unbilled chat without decrementing workspace or payer storage', async () => {
    const response = await DELETE(
      new NextRequest('http://localhost:3000/api/mothership/chats/chat-delete', {
        method: 'DELETE',
      }),
      makeContext('chat-delete')
    )

    expect(response.status).toBe(200)
    expect(mockDbDelete).toHaveBeenCalled()
    expect(mockDecrementStorageUsageForBillingContext).not.toHaveBeenCalled()
    expect(mockDecrementStorageUsageForBillingContextInTx).not.toHaveBeenCalled()
  })
})
