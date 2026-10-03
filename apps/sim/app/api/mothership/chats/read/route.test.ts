import { copilotHttpMock, copilotHttpMockFns, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import {
  mothershipChatLifecycleMock,
  mothershipChatLifecycleMockFns,
} from '@sim/testing/mocks/mothership-chat-lifecycle.mock'
import { mothershipChatStatusMock } from '@sim/testing/mocks/mothership-chat-status.mock'
import { NextRequest } from 'next/server'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockParseRequest } = vi.hoisted(() => ({
  mockParseRequest: vi.fn(),
}))

vi.mock('@/lib/mothership/request/http', () => copilotHttpMock)
vi.mock('@/lib/api/server', () => ({ parseRequest: mockParseRequest }))
vi.mock('@/lib/api/contracts/mothership-chats', () => ({ markMothershipChatReadContract: {} }))
vi.mock('@/lib/mothership/chat/lifecycle', () => mothershipChatLifecycleMock)

vi.mock('@/lib/mothership/chat-status', () => mothershipChatStatusMock)

import { publishChatStatusChanged } from '@/lib/mothership/chat-status'
import { POST } from '@/app/api/mothership/chats/read/route'

const mockGetAccessibleChat = mothershipChatLifecycleMockFns.mockGetAccessibleCopilotChatAuth

function createRequest() {
  return new NextRequest('http://localhost:3000/api/mothership/chats/read', {
    method: 'POST',
    body: JSON.stringify({ chatId: 'chat-1' }),
  })
}

describe('POST /api/mothership/chats/read', () => {
  beforeEach(() => {
    resetDbChainMock()
    copilotHttpMockFns.mockAuthenticateCopilotRequestSessionOnly.mockResolvedValue({
      userId: 'user-1',
      isAuthenticated: true,
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
    })
    mockGetAccessibleChat.mockResolvedValue({ id: 'chat-1', userId: 'user-1' })
    mockParseRequest.mockResolvedValue({ success: true, data: { body: { chatId: 'chat-1' } } })
  })

  afterAll(() => {
    resetDbChainMock()
  })

  it('broadcasts only a changed read marker, avoiding read/refetch loops', async () => {
    mockGetAccessibleChat.mockResolvedValue({
      id: 'chat-1',
      type: 'mothership',
      organizationId: 'org-1',
      userId: 'user-1',
    })
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'chat-1' }]).mockResolvedValueOnce([])
    await POST(createRequest())
    await POST(createRequest())
    expect(publishChatStatusChanged).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ organizationId: 'org-1', userId: 'user-1' }),
      { chatId: 'chat-1', type: 'updated' }
    )
  })

  it('does not update a chat the caller can no longer access', async () => {
    mockGetAccessibleChat.mockResolvedValueOnce(null)
    const res = await POST(createRequest())
    expect(res.status).toBe(200)
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })
})
