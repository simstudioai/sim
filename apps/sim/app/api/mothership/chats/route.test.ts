import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { copilotHttpMock, copilotHttpMockFns } from '@sim/testing/mocks/copilot-http.mock'
import { queueTableRows, resetDbChainMock } from '@sim/testing/mocks/database.mock'
import { mothershipChatStatusMock } from '@sim/testing/mocks/mothership-chat-status.mock'
import { permissionsMock } from '@sim/testing/mocks/permissions.mock'
import { posthogServerMock } from '@sim/testing/mocks/posthog-server.mock'
import { createMockRequest } from '@sim/testing/mocks/request.mock'
import { schemaMock } from '@sim/testing/mocks/schema.mock'
import { workspaceAuthorizationMock } from '@sim/testing/mocks/workspace-authorization.mock'
import {
  createMockWorkspaceApplicationContext,
  workspaceContextMock,
  workspaceContextMockFns,
} from '@sim/testing/mocks/workspace-context.mock'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockReconcileChatStreamMarkers } = vi.hoisted(() => ({
  mockReconcileChatStreamMarkers: vi.fn(),
}))

vi.mock('@/lib/mothership/request/http', () => copilotHttpMock)
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
vi.mock('@/lib/workspaces/application/workspace-context', () => workspaceContextMock)
vi.mock('@/lib/core/application/workspace-authorization', () => workspaceAuthorizationMock)

vi.mock('@/lib/mothership/chat/stream-liveness', () => ({
  reconcileChatStreamMarkers: mockReconcileChatStreamMarkers,
}))

vi.mock('@/lib/mothership/chat-status', () => mothershipChatStatusMock)

vi.mock('@/lib/posthog/server', () => posthogServerMock)

import { GET } from '@/app/api/mothership/chats/route'

function createRequest(workspaceId: string) {
  return createMockRequest({
    url: `http://localhost:3000/api/mothership/chats?workspaceId=${workspaceId}`,
  })
}

describe('GET /api/mothership/chats', () => {
  beforeEach(() => {
    resetDbChainMock()
    workspaceContextMockFns.mockResolveActiveWorkspaceApplicationContext.mockImplementation(
      async (workspaceId: string) =>
        createMockWorkspaceApplicationContext({ workspaceId, billedAccountUserId: 'owner' })
    )

    copilotHttpMockFns.mockAuthenticateCopilotRequestSessionOnly.mockResolvedValue({
      userId: 'user-1',
      isAuthenticated: true,
      principal: createSessionPrincipal(),
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
