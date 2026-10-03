import {
  auditMock,
  auditMockFns,
  authMockFns,
  encryptionMock,
  encryptionMockFns,
  workflowsApiUtilsMock,
  workflowsApiUtilsMockFns,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCheckChatAccess } = vi.hoisted(() => ({
  mockCheckChatAccess: vi.fn(),
}))

const mockCreateErrorResponse = workflowsApiUtilsMockFns.mockCreateErrorResponse
const mockDecryptSecret = encryptionMockFns.mockDecryptSecret
const mockRecordAudit = auditMockFns.mockRecordAudit

vi.mock('@sim/audit', () => auditMock)
vi.mock('@/app/api/workflows/utils', () => workflowsApiUtilsMock)
vi.mock('@/lib/core/security/encryption', () => encryptionMock)
vi.mock('@/app/api/chat/utils', () => ({
  checkChatAccess: mockCheckChatAccess,
}))

import { GET } from '@/app/api/chat/manage/[id]/password/route'

const passwordChat = {
  id: 'chat-123',
  workflowId: 'workflow-123',
  identifier: 'test-chat',
  title: 'Test Chat',
  authType: 'password',
  password: 'encrypted-password',
}

function makeRequest() {
  return new NextRequest('http://localhost:3000/api/chat/manage/chat-123/password')
}

function callGet() {
  return GET(makeRequest(), { params: Promise.resolve({ id: 'chat-123' }) })
}

describe('Chat Password Reveal API Route', () => {
  beforeEach(() => {
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: 'user-id', name: 'Test User', email: 'user@example.com' },
    })

    mockCreateErrorResponse.mockImplementation((message, status = 500) => {
      return new Response(JSON.stringify({ error: message }), {
        status,
        headers: { 'Content-Type': 'application/json' },
      })
    })

    mockDecryptSecret.mockResolvedValue({ decrypted: 'super-secret' })
    mockCheckChatAccess.mockResolvedValue({
      hasAccess: true,
      chat: passwordChat,
      workspaceId: 'workspace-123',
    })
  })

  it('should return 404 when chat not found or access denied', async () => {
    mockCheckChatAccess.mockResolvedValue({ hasAccess: false })

    const response = await callGet()

    expect(response.status).toBe(404)
    const data = await response.json()
    expect(data.error).toBe('Chat not found or access denied')
    expect(mockCheckChatAccess).toHaveBeenCalledWith('chat-123', 'user-id')
    expect(mockDecryptSecret).not.toHaveBeenCalled()
  })

  it('should return 500 without echoing the decryption error', async () => {
    mockDecryptSecret.mockRejectedValue(
      new Error('Invalid encrypted value format. Expected "iv:encrypted:authTag"')
    )

    const response = await callGet()

    expect(response.status).toBe(500)
    const data = await response.json()
    expect(data.error).toBe('Failed to reveal chat password')
    expect(mockRecordAudit).not.toHaveBeenCalled()
  })
})
