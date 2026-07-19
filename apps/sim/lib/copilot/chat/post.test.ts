/**
 * @vitest-environment node
 */

import {
  authMockFns,
  permissionsMock,
  permissionsMockFns,
  workflowsUtilsMock,
  workflowsUtilsMockFns,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
  getLinkedAppProjectForChat,
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
  getLinkedAppProjectForChat: vi.fn(),
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

vi.mock('@/lib/apps/projects', () => ({
  getLinkedAppProjectForChat,
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

vi.mock('@sim/db', () => {
  const update = vi.fn(() => ({
    set: vi.fn(() => ({
      where: vi.fn(() => ({
        returning: vi.fn().mockResolvedValue([]),
      })),
    })),
  }))
  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn().mockResolvedValue([{ permissionType: 'write' }]),
      })),
    })),
  }))
  return {
    db: {
      update,
      select,
      transaction: async (cb: (tx: { update: typeof update; select: typeof select }) => unknown) =>
        cb({ update, select }),
    },
  }
})

vi.mock('drizzle-orm', () => ({
  and: vi.fn(() => ({})),
  eq: vi.fn(() => ({})),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
}))

import { handleUnifiedChatPost } from './post'

describe('handleUnifiedChatPost', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
    getLinkedAppProjectForChat.mockResolvedValue(null)
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

  it('returns 400 for a truncated JSON request body', async () => {
    const response = await handleUnifiedChatPost(
      new NextRequest('http://localhost/api/copilot/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"message":',
      })
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Invalid JSON request body' })
    expect(createSSEStream).not.toHaveBeenCalled()
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

  it('creates a fullstack chat when createNewChat requests chatType fullstack', async () => {
    resolveOrCreateChat.mockResolvedValueOnce({
      chatId: 'chat-fullstack-new',
      chat: {
        id: 'chat-fullstack-new',
        type: 'fullstack',
        workspaceId: 'ws-1',
      },
      conversationHistory: [],
      isNew: true,
    })

    const response = await handleUnifiedChatPost(
      new NextRequest('http://localhost/api/copilot/chat', {
        method: 'POST',
        body: JSON.stringify({
          message: 'Build a TikTok profile app',
          workspaceId: 'ws-1',
          createNewChat: true,
          chatType: 'fullstack',
        }),
      })
    )

    expect(response.status).toBe(200)
    expect(resolveOrCreateChat).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'fullstack',
        workspaceId: 'ws-1',
      })
    )
    expect(createSSEStream).toHaveBeenCalledWith(
      expect.objectContaining({
        requestPayload: expect.objectContaining({
          chatType: 'fullstack',
        }),
      })
    )
  })

  it('rejects a workflow seed on a normal mothership chat', async () => {
    resolveOrCreateChat.mockResolvedValueOnce({
      chatId: 'chat-mothership',
      chat: { id: 'chat-mothership', type: 'mothership', workspaceId: 'ws-1' },
      conversationHistory: [],
      isNew: false,
    })

    const response = await handleUnifiedChatPost(
      new NextRequest('http://localhost/api/copilot/chat', {
        method: 'POST',
        body: JSON.stringify({
          message: 'Build an interface',
          workspaceId: 'ws-1',
          chatId: 'chat-mothership',
          fullstackSeed: {
            source: 'existing_workflow',
            workflowIds: ['00000000-0000-4000-8000-000000000001'],
            design: {},
          },
        }),
      })
    )

    expect(response.status).toBe(400)
    expect(createSSEStream).not.toHaveBeenCalled()
  })

  it('preserves fullstack type in the Go payload and Sim execution context', async () => {
    getLinkedAppProjectForChat.mockResolvedValueOnce({
      id: 'app-1',
      name: 'My App',
      slug: 'my-app',
      publicId: 'public-1',
      draftRevisionId: 'revision-1',
      publishedReleaseId: null,
    })
    resolveOrCreateChat.mockResolvedValueOnce({
      chatId: 'chat-fullstack',
      chat: {
        id: 'chat-fullstack',
        type: 'fullstack',
        workspaceId: 'ws-1',
      },
      conversationHistory: [],
      isNew: false,
    })

    const response = await handleUnifiedChatPost(
      new NextRequest('http://localhost/api/copilot/chat', {
        method: 'POST',
        body: JSON.stringify({
          message: 'Build my app',
          workspaceId: 'ws-1',
          chatId: 'chat-fullstack',
          fullstackSeed: {
            source: 'existing_workflow',
            workflowIds: ['00000000-0000-4000-8000-000000000001'],
            design: {
              primaryColor: '#2563eb',
              style: 'professional',
              theme: 'dark',
            },
          },
        }),
      })
    )

    expect(response.status).toBe(200)
    expect(createSSEStream).toHaveBeenCalledWith(
      expect.objectContaining({
        requestPayload: expect.objectContaining({
          chatType: 'fullstack',
          appProject: expect.objectContaining({
            id: 'app-1',
            draftRevisionId: 'revision-1',
          }),
          fullstackSeed: expect.objectContaining({
            source: 'existing_workflow',
            workflowIds: ['00000000-0000-4000-8000-000000000001'],
          }),
        }),
        orchestrateOptions: expect.objectContaining({
          executionContext: expect.objectContaining({ requestMode: 'fullstack' }),
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
