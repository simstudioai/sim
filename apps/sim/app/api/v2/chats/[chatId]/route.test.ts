/**
 * @vitest-environment node
 */
import { dbChainMockFns, flattenMockConditions, resetDbChainMock, schemaMock } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckRateLimit,
  mockEnvFlags,
  mockGetAccessibleCopilotChatWithMessages,
  mockIssueV2ChatContinuationToken,
  mockPublishStatusChanged,
  mockCaptureServerEvent,
  mockReconcileChatStreamMarkers,
  mockResolveWorkspaceAccess,
  mockV2ApiGateError,
} = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
  mockEnvFlags: { isAuthDisabled: false },
  mockGetAccessibleCopilotChatWithMessages: vi.fn(),
  mockIssueV2ChatContinuationToken: vi.fn(),
  mockPublishStatusChanged: vi.fn(),
  mockCaptureServerEvent: vi.fn(),
  mockReconcileChatStreamMarkers: vi.fn(),
  mockResolveWorkspaceAccess: vi.fn(),
  mockV2ApiGateError: vi.fn(),
}))

vi.mock('@/app/api/v1/middleware', () => ({
  checkRateLimit: mockCheckRateLimit,
  resolveWorkspaceAccess: mockResolveWorkspaceAccess,
}))

vi.mock('@/app/api/v2/lib/gate', () => ({
  v2ApiGateError: mockV2ApiGateError,
}))

vi.mock('@/lib/copilot/chat/lifecycle', () => ({
  getAccessibleCopilotChatWithMessages: mockGetAccessibleCopilotChatWithMessages,
}))

vi.mock('@/lib/copilot/chat/stream-liveness', () => ({
  reconcileChatStreamMarkers: mockReconcileChatStreamMarkers,
}))

vi.mock('@/lib/copilot/headless/continuation-token', () => ({
  issueV2ChatContinuationToken: mockIssueV2ChatContinuationToken,
}))

vi.mock('@/lib/copilot/chat-status', () => ({
  chatPubSub: { publishStatusChanged: mockPublishStatusChanged },
}))

vi.mock('@/lib/posthog/server', () => ({
  captureServerEvent: mockCaptureServerEvent,
}))

vi.mock('@/lib/core/config/env-flags', () => mockEnvFlags)

import { GET, PATCH } from '@/app/api/v2/chats/[chatId]/route'

const RATE_LIMIT = {
  allowed: true,
  userId: 'user-1',
  keyType: 'personal' as const,
  limit: 100,
  remaining: 99,
  resetAt: new Date('2026-08-07T13:00:00.000Z'),
}

function buildChat(overrides: Record<string, unknown> = {}) {
  return {
    id: 'chat-1',
    userId: 'user-1',
    workflowId: null,
    workspaceId: 'workspace-1',
    type: 'mothership',
    title: 'Release plan',
    conversationId: 'stream-stale',
    resources: null,
    createdAt: new Date('2026-08-07T11:00:00.000Z'),
    updatedAt: new Date('2026-08-07T12:00:00.000Z'),
    messages: [],
    ...overrides,
  }
}

function callDetail(query = 'workspaceId=workspace-1') {
  return GET(new NextRequest(`http://localhost:3000/api/v2/chats/chat-1?${query}`), {
    params: Promise.resolve({ chatId: 'chat-1' }),
  })
}

function callRename(body: Record<string, unknown>) {
  return PATCH(
    new NextRequest('http://localhost:3000/api/v2/chats/chat-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ chatId: 'chat-1' }) }
  )
}

describe('GET /api/v2/chats/[chatId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEnvFlags.isAuthDisabled = false
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT)
    mockV2ApiGateError.mockResolvedValue(null)
    mockResolveWorkspaceAccess.mockResolvedValue(null)
    mockGetAccessibleCopilotChatWithMessages.mockResolvedValue(buildChat())
    mockReconcileChatStreamMarkers.mockResolvedValue(
      new Map([['chat-1', { chatId: 'chat-1', streamId: null, status: 'inactive' }]])
    )
    mockIssueV2ChatContinuationToken.mockResolvedValue('continuation-token')
  })

  it('rejects workspace keys before loading private chat history', async () => {
    mockCheckRateLimit.mockResolvedValue({ ...RATE_LIMIT, keyType: 'workspace' })

    const response = await callDetail()

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      error: {
        code: 'FORBIDDEN',
        message: 'Chat history requires a personal API key',
      },
    })
    expect(mockResolveWorkspaceAccess).not.toHaveBeenCalled()
    expect(mockGetAccessibleCopilotChatWithMessages).not.toHaveBeenCalled()
  })

  it('returns the workspace-access failure without loading the chat', async () => {
    mockResolveWorkspaceAccess.mockResolvedValue({
      status: 403,
      code: 'FORBIDDEN',
      message: 'Access denied',
    })

    const response = await callDetail()

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      error: { code: 'FORBIDDEN', message: 'Access denied' },
    })
    expect(mockResolveWorkspaceAccess).toHaveBeenCalledWith(
      RATE_LIMIT,
      'user-1',
      'workspace-1',
      'read'
    )
    expect(mockGetAccessibleCopilotChatWithMessages).not.toHaveBeenCalled()
  })

  it('treats the auth-disabled principal like a session principal for workspace access', async () => {
    mockEnvFlags.isAuthDisabled = true

    const response = await callDetail()

    expect(response.status).toBe(200)
    expect(mockResolveWorkspaceAccess).toHaveBeenCalledWith(
      expect.objectContaining({ keyType: undefined }),
      'user-1',
      'workspace-1',
      'read'
    )
  })

  it.each([
    ['an inaccessible chat', null],
    ['a workflow-scoped chat', buildChat({ type: 'copilot' })],
    ['a chat from another workspace', buildChat({ workspaceId: 'workspace-2' })],
  ])('masks %s as the same not-found response', async (_case, chat) => {
    mockGetAccessibleCopilotChatWithMessages.mockResolvedValue(chat)

    const response = await callDetail()

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'Chat not found' },
    })
    expect(mockIssueV2ChatContinuationToken).not.toHaveBeenCalled()
    expect(mockReconcileChatStreamMarkers).not.toHaveBeenCalled()
  })

  it('projects display-safe messages and reports the reconciled active marker', async () => {
    mockGetAccessibleCopilotChatWithMessages.mockResolvedValue(
      buildChat({
        messages: [
          {
            id: 'message-user',
            role: 'user',
            content: 'Ship it',
            timestamp: '2026-08-07T11:30:00.000Z',
            contexts: [{ kind: 'workflow', label: 'Release', workflowId: 'workflow-1' }],
          },
          {
            id: 'message-assistant',
            role: 'assistant',
            content: 'Done',
            timestamp: '2026-08-07T11:31:00.000Z',
            requestId: 'request-private',
            contentBlocks: [{ type: 'text', content: 'Done' }],
          },
          {
            id: 'message-system',
            role: 'system',
            content: 'private instructions',
            timestamp: '2026-08-07T11:29:00.000Z',
          },
          null,
        ],
      })
    )
    mockReconcileChatStreamMarkers.mockResolvedValueOnce(
      new Map([['chat-1', { chatId: 'chat-1', streamId: 'stream-live', status: 'active' }]])
    )

    const response = await callDetail('workspaceId=workspace-1&readOnly=true')
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data).toEqual({
      id: 'chat-1',
      title: 'Release plan',
      active: true,
      continuationToken: 'continuation-token',
      messages: [
        {
          id: 'message-user',
          role: 'user',
          content: 'Ship it',
          timestamp: '2026-08-07T11:30:00.000Z',
        },
        {
          id: 'message-assistant',
          role: 'assistant',
          content: 'Done',
          timestamp: '2026-08-07T11:31:00.000Z',
        },
      ],
    })
    expect(mockReconcileChatStreamMarkers).toHaveBeenCalledWith(
      [{ chatId: 'chat-1', streamId: 'stream-stale' }],
      { repairVerifiedStaleMarkers: true }
    )
  })

  it.each([
    ['true', true],
    ['false', false],
  ])('binds readOnly=%s into the minted continuation token', async (raw, expected) => {
    const response = await callDetail(`workspaceId=workspace-1&readOnly=${raw}`)

    expect(response.status).toBe(200)
    expect(mockIssueV2ChatContinuationToken).toHaveBeenCalledWith({
      chatId: 'chat-1',
      workspaceId: 'workspace-1',
      authorizationUserId: 'user-1',
      credentialType: 'personal',
      readOnly: expected,
      persistence: 'sim',
    })
  })
})

describe('PATCH /api/v2/chats/[chatId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockEnvFlags.isAuthDisabled = false
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT)
    mockV2ApiGateError.mockResolvedValue(null)
    mockResolveWorkspaceAccess.mockResolvedValue(null)
  })

  it('renames an owned chat and notifies the synchronized Home list', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'chat-1', workspaceId: 'workspace-1' }])

    const response = await callRename({
      workspaceId: 'workspace-1',
      title: 'Incident investigation',
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: { id: 'chat-1', title: 'Incident investigation' },
    })
    expect(dbChainMockFns.set).toHaveBeenCalledWith({
      title: 'Incident investigation',
      updatedAt: expect.any(Date),
      lastSeenAt: expect.any(Date),
    })
    const conditions = flattenMockConditions(dbChainMockFns.where.mock.calls.at(-1)?.[0])
    expect(conditions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'eq',
          left: schemaMock.copilotChats.id,
          right: 'chat-1',
        }),
        expect.objectContaining({
          type: 'eq',
          left: schemaMock.copilotChats.userId,
          right: 'user-1',
        }),
        expect.objectContaining({
          type: 'eq',
          left: schemaMock.copilotChats.workspaceId,
          right: 'workspace-1',
        }),
        expect.objectContaining({
          type: 'eq',
          left: schemaMock.copilotChats.type,
          right: 'mothership',
        }),
        expect.objectContaining({
          type: 'isNull',
          column: schemaMock.copilotChats.deletedAt,
        }),
      ])
    )
    expect(mockPublishStatusChanged).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      chatId: 'chat-1',
      type: 'renamed',
    })
    expect(mockCaptureServerEvent).toHaveBeenCalledWith(
      'user-1',
      'task_renamed',
      { workspace_id: 'workspace-1' },
      { groups: { workspace: 'workspace-1' } }
    )
  })

  it('rejects workspace keys before touching private chat data', async () => {
    mockCheckRateLimit.mockResolvedValue({ ...RATE_LIMIT, keyType: 'workspace' })

    const response = await callRename({ workspaceId: 'workspace-1', title: 'Private title' })

    expect(response.status).toBe(403)
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('returns the workspace-access failure before updating the chat', async () => {
    mockResolveWorkspaceAccess.mockResolvedValue({
      status: 403,
      code: 'FORBIDDEN',
      message: 'Access denied',
    })

    const response = await callRename({ workspaceId: 'workspace-1', title: 'Private title' })

    expect(response.status).toBe(403)
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('masks missing, deleted, foreign, and non-mothership chats as not found', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([])

    const response = await callRename({ workspaceId: 'workspace-1', title: 'Private title' })

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'Chat not found' },
    })
    expect(mockPublishStatusChanged).not.toHaveBeenCalled()
  })
})
