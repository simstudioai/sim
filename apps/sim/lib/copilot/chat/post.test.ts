/**
 * @vitest-environment node
 */

import {
  authMockFns,
  dbChainMock,
  permissionsMock,
  permissionsMockFns,
  resetDbChainMock,
  workflowsUtilsMock,
  workflowsUtilsMockFns,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const resolveWorkflowIdForUser = workflowsUtilsMockFns.mockResolveWorkflowIdForUser
const getUserEntityPermissions = permissionsMockFns.mockGetUserEntityPermissions

const {
  getEffectiveDecryptedEnv,
  generateWorkspaceSnapshot,
  processContextsServer,
  resolveActiveResourceContext,
  buildCopilotRequestPayload,
  createSSEStream,
  acquirePendingChatStream,
  getPendingChatStreamId,
  releasePendingChatStream,
  resolveOrCreateChat,
  resolveBillingAttribution,
  finalizeAssistantTurn,
  appendCopilotChatMessages,
  mockPublishStatusChanged,
} = vi.hoisted(() => ({
  getEffectiveDecryptedEnv: vi.fn(),
  generateWorkspaceSnapshot: vi.fn(),
  processContextsServer: vi.fn(),
  resolveActiveResourceContext: vi.fn(),
  buildCopilotRequestPayload: vi.fn(),
  createSSEStream: vi.fn(),
  acquirePendingChatStream: vi.fn(),
  getPendingChatStreamId: vi.fn(),
  releasePendingChatStream: vi.fn(),
  resolveOrCreateChat: vi.fn(),
  resolveBillingAttribution: vi.fn(),
  finalizeAssistantTurn: vi.fn(),
  appendCopilotChatMessages: vi.fn(),
  mockPublishStatusChanged: vi.fn(),
}))

const getSession = authMockFns.mockGetSession
const billingAttribution = {
  actorUserId: 'user-1',
  billedAccountUserId: 'owner-1',
  billingEntity: { type: 'organization' as const, id: 'org-1' },
  billingPeriod: {
    start: '2026-07-01T00:00:00.000Z',
    end: '2026-08-01T00:00:00.000Z',
  },
  organizationId: 'org-1',
  payerSubscription: null,
  workspaceId: 'ws-1',
}

vi.mock('@/lib/workflows/utils', () => workflowsUtilsMock)

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

vi.mock('@/lib/billing/core/billing-attribution', () => ({
  resolveBillingAttribution,
}))

vi.mock('@/lib/environment/utils', () => ({
  getEffectiveDecryptedEnv,
}))

vi.mock('@/lib/copilot/chat/workspace-context', () => ({
  generateWorkspaceSnapshot,
}))

vi.mock('@/lib/copilot/chat/process-contents', () => ({
  processContextsServer,
  resolveActiveResourceContext,
}))

vi.mock('@/lib/copilot/chat/payload', () => ({
  buildCopilotRequestPayload,
}))

vi.mock('@/lib/copilot/request/lifecycle/start', () => ({
  createSSEStream,
  SSE_RESPONSE_HEADERS: { 'Content-Type': 'text/event-stream' },
}))

vi.mock('@/lib/copilot/request/session', () => ({
  acquirePendingChatStream,
  getPendingChatStreamId,
  releasePendingChatStream,
}))

vi.mock('@/lib/copilot/chat/lifecycle', () => ({
  resolveOrCreateChat,
}))

vi.mock('@/lib/copilot/chat/terminal-state', () => ({
  finalizeAssistantTurn,
}))

vi.mock('@/lib/copilot/chat/messages-store', () => ({
  appendCopilotChatMessages,
}))

vi.mock('@/lib/copilot/chat-status', () => ({
  chatPubSub: {
    publishStatusChanged: mockPublishStatusChanged,
  },
}))

vi.mock('@sim/db', () => dbChainMock)

import { handleUnifiedChatPost } from './post'

describe('handleUnifiedChatPost', () => {
  afterAll(() => {
    resetDbChainMock()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    getSession.mockResolvedValue({ user: { id: 'user-1' } })
    resolveWorkflowIdForUser.mockResolvedValue({
      status: 'resolved',
      workflowId: 'wf-1',
      workspaceId: 'ws-1',
      workflowName: 'Workflow One',
    })
    getUserEntityPermissions.mockResolvedValue('write')
    resolveBillingAttribution.mockResolvedValue(billingAttribution)
    getEffectiveDecryptedEnv.mockResolvedValue({ API_KEY: 'secret' })
    generateWorkspaceSnapshot.mockResolvedValue({
      markdown: 'workspace context',
      snapshot: { workflows: [{ id: 'wf-1', name: 'Alpha', path: 'workflows/Alpha' }] },
    })
    processContextsServer.mockResolvedValue([])
    resolveActiveResourceContext.mockResolvedValue(null)
    buildCopilotRequestPayload.mockImplementation(async (params: Record<string, unknown>) => params)
    createSSEStream.mockReturnValue(new ReadableStream())
    acquirePendingChatStream.mockResolvedValue(true)
    getPendingChatStreamId.mockResolvedValue(null)
    releasePendingChatStream.mockResolvedValue(undefined)
    resolveOrCreateChat.mockResolvedValue({
      chatId: 'chat-1',
      chat: { id: 'chat-1' },
      conversationHistory: [],
      isNew: true,
    })
    finalizeAssistantTurn.mockResolvedValue({
      found: true,
      updated: true,
      appendedAssistant: true,
      workspaceId: 'ws-1',
      outcome: 'appended_assistant',
    })
  })

  it('routes workflow-attached chat requests through the copilot backend path', async () => {
    const response = await handleUnifiedChatPost(
      new NextRequest('http://localhost/api/copilot/chat', {
        method: 'POST',
        body: JSON.stringify({
          message: 'Hello',
          workflowId: 'wf-1',
          workspaceId: 'ws-1',
        }),
      })
    )

    expect(response.status).toBe(200)
    expect(generateWorkspaceSnapshot).toHaveBeenCalledWith('ws-1', 'user-1')
    expect(buildCopilotRequestPayload).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-opus-4-8',
        workspaceContext: 'workspace context',
        // Regression guard: the branch must forward the typed snapshot, not drop it.
        vfs: expect.objectContaining({ workflows: expect.any(Array) }),
      }),
      { selectedModel: 'claude-opus-4-8' }
    )
    expect(createSSEStream).toHaveBeenCalledWith(
      expect.objectContaining({
        titleModel: 'claude-opus-4-8',
        workspaceId: 'ws-1',
        orchestrateOptions: expect.objectContaining({
          workflowId: 'wf-1',
          goRoute: '/api/copilot',
          executionContext: expect.objectContaining({
            userId: 'user-1',
            workflowId: 'wf-1',
            workspaceId: 'ws-1',
            billingAttribution,
            requestMode: 'agent',
          }),
        }),
      })
    )
  })

  it('routes workspace chat requests through the mothership backend path', async () => {
    const response = await handleUnifiedChatPost(
      new NextRequest('http://localhost/api/copilot/chat', {
        method: 'POST',
        body: JSON.stringify({
          message: 'Hello',
          workspaceId: 'ws-1',
          createNewChat: true,
        }),
      })
    )

    expect(response.status).toBe(200)
    expect(buildCopilotRequestPayload).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws-1',
        workspaceContext: 'workspace context',
        // Regression guard: the branch must forward the typed snapshot, not drop it.
        vfs: expect.objectContaining({ workflows: expect.any(Array) }),
      }),
      { selectedModel: '' }
    )
    expect(createSSEStream).toHaveBeenCalledWith(
      expect.objectContaining({
        titleModel: 'claude-opus-4-8',
        workspaceId: 'ws-1',
        orchestrateOptions: expect.objectContaining({
          workspaceId: 'ws-1',
          goRoute: '/api/mothership',
          executionContext: expect.objectContaining({
            userId: 'user-1',
            workflowId: '',
            workspaceId: 'ws-1',
            billingAttribution,
            requestMode: 'agent',
          }),
        }),
      })
    )
  })

  it('accepts tagged skill contexts and forwards them to context resolution', async () => {
    const response = await handleUnifiedChatPost(
      new NextRequest('http://localhost/api/copilot/chat', {
        method: 'POST',
        body: JSON.stringify({
          message: 'Hello',
          workspaceId: 'ws-1',
          createNewChat: true,
          contexts: [{ kind: 'skill', skillId: 'sk-1', label: 'my-skill' }],
        }),
      })
    )

    expect(response.status).toBe(200)
    expect(processContextsServer).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'skill', skillId: 'sk-1', label: 'my-skill' }),
      ]),
      'user-1',
      'Hello',
      'ws-1',
      expect.anything()
    )
  })

  it('forwards slash-selected MCP server ids to the request-local tool builder', async () => {
    const response = await handleUnifiedChatPost(
      new NextRequest('http://localhost/api/copilot/chat', {
        method: 'POST',
        body: JSON.stringify({
          message: '/Docs search auth',
          workspaceId: 'ws-1',
          createNewChat: true,
          contexts: [{ kind: 'mcp', serverId: 'mcp-server-1', label: 'Docs' }],
        }),
      })
    )

    expect(response.status).toBe(200)
    expect(buildCopilotRequestPayload).toHaveBeenCalledWith(
      expect.objectContaining({ mcpServerIds: ['mcp-server-1'] }),
      { selectedModel: '' }
    )
  })

  it('persists cancelled partial responses from the server lifecycle', async () => {
    await handleUnifiedChatPost(
      new NextRequest('http://localhost/api/copilot/chat', {
        method: 'POST',
        body: JSON.stringify({
          message: 'Hello',
          workspaceId: 'ws-1',
          createNewChat: true,
        }),
      })
    )

    const streamArgs = createSSEStream.mock.calls[0]?.[0]
    const onComplete = streamArgs?.orchestrateOptions?.onComplete
    expect(onComplete).toBeTypeOf('function')

    await onComplete({
      success: false,
      cancelled: true,
      content: 'partial answer',
      contentBlocks: [],
      toolCalls: [],
      chatId: 'chat-1',
      requestId: 'request-1',
    })

    expect(finalizeAssistantTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 'chat-1',
        userMessageId: expect.any(String),
        streamMarkerPolicy: 'active-or-cleared',
        assistantMessage: expect.objectContaining({
          role: 'assistant',
          content: 'partial answer',
          contentBlocks: expect.arrayContaining([
            expect.objectContaining({ type: 'complete', status: 'cancelled' }),
          ]),
        }),
      })
    )
  })

  it('persists partial responses when the server lifecycle throws (onError)', async () => {
    await handleUnifiedChatPost(
      new NextRequest('http://localhost/api/copilot/chat', {
        method: 'POST',
        body: JSON.stringify({
          message: 'Hello',
          workspaceId: 'ws-1',
          createNewChat: true,
        }),
      })
    )

    const streamArgs = createSSEStream.mock.calls[0]?.[0]
    const onError = streamArgs?.orchestrateOptions?.onError
    expect(onError).toBeTypeOf('function')

    await onError(new Error('bedrock overloaded'), {
      success: false,
      cancelled: false,
      content: 'partial answer',
      contentBlocks: [],
      toolCalls: [],
      chatId: 'chat-1',
      requestId: 'request-1',
    })

    expect(finalizeAssistantTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 'chat-1',
        userMessageId: expect.any(String),
        streamMarkerPolicy: 'active-or-cleared',
        assistantMessage: expect.objectContaining({
          role: 'assistant',
          content: 'partial answer',
        }),
      })
    )
  })

  it('clears the stream marker without an assistant message when nothing streamed before the throw', async () => {
    await handleUnifiedChatPost(
      new NextRequest('http://localhost/api/copilot/chat', {
        method: 'POST',
        body: JSON.stringify({
          message: 'Hello',
          workspaceId: 'ws-1',
          createNewChat: true,
        }),
      })
    )

    const streamArgs = createSSEStream.mock.calls[0]?.[0]
    const onError = streamArgs?.orchestrateOptions?.onError
    expect(onError).toBeTypeOf('function')

    await onError(new Error('immediate failure'), {
      success: false,
      cancelled: false,
      content: '',
      contentBlocks: [],
      toolCalls: [],
      chatId: 'chat-1',
      requestId: 'request-1',
    })

    const lastCall = finalizeAssistantTurn.mock.calls.at(-1)?.[0]
    expect(lastCall).toMatchObject({
      chatId: 'chat-1',
      streamMarkerPolicy: 'active-or-cleared',
    })
    expect(lastCall?.assistantMessage).toBeUndefined()
  })

  it('republishes completed status when cancelled lifecycle persistence already ran', async () => {
    await handleUnifiedChatPost(
      new NextRequest('http://localhost/api/copilot/chat', {
        method: 'POST',
        body: JSON.stringify({
          message: 'Hello',
          workspaceId: 'ws-1',
          createNewChat: true,
        }),
      })
    )

    const streamArgs = createSSEStream.mock.calls[0]?.[0]
    const onComplete = streamArgs?.orchestrateOptions?.onComplete
    expect(onComplete).toBeTypeOf('function')

    finalizeAssistantTurn.mockResolvedValueOnce({
      found: true,
      updated: false,
      appendedAssistant: false,
      workspaceId: 'ws-1',
      outcome: 'assistant_already_persisted',
    })

    await onComplete({
      success: false,
      cancelled: true,
      content: 'partial answer',
      contentBlocks: [],
      toolCalls: [],
      chatId: 'chat-1',
      requestId: 'request-1',
    })

    expect(mockPublishStatusChanged).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      chatId: 'chat-1',
      type: 'completed',
      streamId: streamArgs?.streamId,
    })
  })

  it('rejects requests that have neither workflow nor workspace attachment', async () => {
    const response = await handleUnifiedChatPost(
      new NextRequest('http://localhost/api/copilot/chat', {
        method: 'POST',
        body: JSON.stringify({
          message: 'Hello',
        }),
      })
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'workspaceId is required when workflowId is not provided',
    })
  })
})
