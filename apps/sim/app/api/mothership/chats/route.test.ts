import {
  copilotHttpMock,
  copilotHttpMockFns,
  permissionsMock,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockReconcileChatStreamMarkers } = vi.hoisted(() => ({
  mockReconcileChatStreamMarkers: vi.fn(),
}))

vi.mock('@/lib/mothership/request/http', () => copilotHttpMock)
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  resolveActiveWorkspaceApplicationContext: async (workspaceId: string) => ({
    workspaceId,
    workspaceOrganizationId: null,
    allowPersonalApiKeys: true,
    billedAccountUserId: 'owner',
  }),
}))
vi.mock('@/lib/core/application/workspace-authorization', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/core/application/workspace-authorization')>()),
  authorizeWorkspaceOperation: async () => undefined,
}))

vi.mock('@/lib/mothership/chat/stream-liveness', () => ({
  reconcileChatStreamMarkers: mockReconcileChatStreamMarkers,
}))

vi.mock('@/lib/mothership/chat-status', () => ({
  chatPubSub: { publishStatusChanged: vi.fn() },
}))

vi.mock('@/lib/posthog/server', () => ({
  captureServerEvent: vi.fn(),
}))

import { GET } from '@/app/api/mothership/chats/route'

function createRequest(workspaceId: string) {
  return new NextRequest(`http://localhost:3000/api/mothership/chats?workspaceId=${workspaceId}`, {
    method: 'GET',
  })
}

describe('GET /api/mothership/chats', () => {
  beforeEach(() => {
    resetDbChainMock()

    copilotHttpMockFns.mockAuthenticateCopilotRequestSessionOnly.mockResolvedValue({
      userId: 'user-1',
      isAuthenticated: true,
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
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
  })

  it('clears activeStreamId on chats whose redis lock has expired (stuck-yellow bug)', async () => {
    const now = new Date('2026-05-11T12:00:00Z')
    queueTableRows(schemaMock.copilotChats, [
      {
        id: 'chat-stuck',
        title: 'Stuck chat',
        updatedAt: now,
        activeStreamId: 'stream-orphaned',
        lastSeenAt: null,
      },
      {
        id: 'chat-live',
        title: 'Live chat',
        updatedAt: now,
        activeStreamId: 'stream-live',
        lastSeenAt: null,
      },
      {
        id: 'chat-idle',
        title: 'Idle chat',
        updatedAt: now,
        activeStreamId: null,
        lastSeenAt: null,
      },
    ])
    mockReconcileChatStreamMarkers.mockResolvedValueOnce(
      new Map([
        ['chat-stuck', { chatId: 'chat-stuck', streamId: null, status: 'inactive' }],
        ['chat-live', { chatId: 'chat-live', streamId: 'stream-live', status: 'active' }],
        ['chat-idle', { chatId: 'chat-idle', streamId: null, status: 'inactive' }],
      ])
    )

    const response = await GET(createRequest('ws-1'))
    expect(response.status).toBe(200)
    const body = await response.json()

    expect(mockReconcileChatStreamMarkers).toHaveBeenCalledWith(
      [
        { chatId: 'chat-stuck', streamId: 'stream-orphaned' },
        { chatId: 'chat-live', streamId: 'stream-live' },
        { chatId: 'chat-idle', streamId: null },
      ],
      { repairVerifiedStaleMarkers: true }
    )
    expect(body.success).toBe(true)
    expect(body.data).toEqual([
      expect.objectContaining({ id: 'chat-stuck', activeStreamId: null }),
      expect.objectContaining({ id: 'chat-live', activeStreamId: 'stream-live' }),
      expect.objectContaining({ id: 'chat-idle', activeStreamId: null }),
    ])
  })

  afterAll(() => {
    resetDbChainMock()
  })
})
