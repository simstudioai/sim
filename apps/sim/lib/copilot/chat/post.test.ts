/**
 * @vitest-environment node
 */

import {
  authMockFns,
  dbChainMockFns,
  environmentUtilsMockFns,
  permissionGroupScopeMock,
  permissionGroupScopeMockFns,
  permissionsMock,
  permissionsMockFns,
  resetDbChainMock,
  resetEnvironmentUtilsMock,
  workflowsUtilsMock,
  workflowsUtilsMockFns,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const resolveWorkflowIdForUser = workflowsUtilsMockFns.mockResolveWorkflowIdForUser
const getUserEntityPermissions = permissionsMockFns.mockGetUserEntityPermissions

const getEffectiveEnvironmentSnapshot = environmentUtilsMockFns.mockGetEffectiveEnvironmentSnapshot

const {
  computeWorkspaceEntitlements,
  listPersonal,
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
  resolveOrganizationBillingAttribution,
  authorizeOrganizationChat,
  finalizeAssistantTurn,
  appendCopilotChatMessages,
  persistChatResources,
  mockPublishStatusChanged,
  atomicallyClaimChatSend,
  storeChatSendResult,
  releaseChatSendClaim,
} = vi.hoisted(() => ({
  computeWorkspaceEntitlements: vi.fn(async () => []),
  listPersonal: vi.fn(),
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
  resolveOrganizationBillingAttribution: vi.fn(),
  authorizeOrganizationChat: vi.fn(),
  finalizeAssistantTurn: vi.fn(),
  appendCopilotChatMessages: vi.fn(),
  persistChatResources: vi.fn(),
  mockPublishStatusChanged: vi.fn(),
  atomicallyClaimChatSend: vi.fn(),
  storeChatSendResult: vi.fn(),
  releaseChatSendClaim: vi.fn(),
}))

/**
 * The root span, captured so a test can assert what a refused turn exported.
 * `withCopilotSpan` is a pass-through here — the nesting it provides is not
 * under test and a real tracer would need an exporter to observe.
 */
const { setInputMessages, setUserMessagePreview, startCopilotOtelRoot } = vi.hoisted(() => ({
  setInputMessages: vi.fn(),
  setUserMessagePreview: vi.fn(),
  startCopilotOtelRoot: vi.fn(),
}))

vi.mock('@/lib/copilot/request/otel', async () => {
  const { ROOT_CONTEXT, trace } = await import('@opentelemetry/api')
  const span = () => trace.getTracer('post-test').startSpan('post-test')
  startCopilotOtelRoot.mockImplementation(() => ({
    span: span(),
    context: ROOT_CONTEXT,
    requestId: 'req-1',
    finish: vi.fn(),
    setUserMessagePreview,
    setInputMessages,
    setOutputMessages: vi.fn(),
    setRequestShape: vi.fn(),
  }))
  return {
    startCopilotOtelRoot,
    withCopilotSpan: (
      _name: string,
      _attrs: Record<string, unknown> | undefined,
      fn: (child: ReturnType<typeof span>) => unknown,
      _context?: unknown
    ) => fn(span()),
  }
})

const resolvePermissionGroupConfig = permissionGroupScopeMockFns.mockResolvePermissionGroupConfig

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
  resolveOrganizationBillingAttribution,
}))

vi.mock('@/lib/copilot/chat/organization-chats', () => ({
  authorizeOrganizationChat: { execute: authorizeOrganizationChat },
}))

vi.mock('@/lib/credentials/application/personal-credentials', () => ({
  listPersonalCredentials: { execute: listPersonal },
}))

vi.mock('@/lib/copilot/entitlements', () => ({ computeWorkspaceEntitlements }))

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

vi.mock('@/lib/core/idempotency', () => ({
  chatSendIdempotency: {
    atomicallyClaim: atomicallyClaimChatSend,
    storeResult: storeChatSendResult,
    release: releaseChatSendClaim,
  },
}))

vi.mock('@/lib/copilot/chat/terminal-state', () => ({
  finalizeAssistantTurn,
}))

vi.mock('@/lib/copilot/chat/messages-store', () => ({
  appendCopilotChatMessages,
}))

vi.mock('@/lib/copilot/resources/persistence', () => ({
  persistChatResources,
}))

vi.mock('@/lib/permission-groups/config-scope.server', () => permissionGroupScopeMock)

vi.mock('@/lib/copilot/chat-status', () => ({
  chatPubSub: {
    publishStatusChanged: mockPublishStatusChanged,
  },
}))

import { chatOperations } from '@/lib/copilot/application/operations'
import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'
import { handleUnifiedChatPost } from './post'

describe('handleUnifiedChatPost', () => {
  afterAll(() => {
    resetDbChainMock()
    resetEnvironmentUtilsMock()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    atomicallyClaimChatSend.mockResolvedValue({
      claimed: true,
      normalizedKey: 'chat-send:user-message:msg-1:userId=user-1',
      storageMethod: 'database',
      claimToken: 'claim-1',
    })
    storeChatSendResult.mockResolvedValue(true)
    releaseChatSendClaim.mockResolvedValue(undefined)
    getSession.mockResolvedValue({ user: { id: 'user-1' } })
    resolvePermissionGroupConfig.mockResolvedValue(null)
    resolveWorkflowIdForUser.mockResolvedValue({
      status: 'resolved',
      workflowId: 'wf-1',
      workspaceId: 'ws-1',
      workflowName: 'Workflow One',
    })
    getUserEntityPermissions.mockResolvedValue('write')
    resolveBillingAttribution.mockResolvedValue(billingAttribution)
    resolveOrganizationBillingAttribution.mockResolvedValue({
      ...billingAttribution,
      workspaceId: null,
    })
    authorizeOrganizationChat.mockResolvedValue({
      organizationId: 'org-1',
      userId: 'user-1',
      role: 'member',
    })
    getEffectiveEnvironmentSnapshot.mockResolvedValue({
      personalEncrypted: { API_KEY: 'encrypted-secret' },
      workspaceEncrypted: {},
      personalDecrypted: { API_KEY: 'secret' },
      workspaceDecrypted: {},
      conflicts: [],
      decryptionFailures: [],
    })
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

  it('denies removed organization membership before persisting a turn', async () => {
    getSession.mockResolvedValue({ user: { id: 'user-1' }, session: { id: 'session-1' } })
    authorizeOrganizationChat.mockRejectedValueOnce(
      new OrchestrationError('not_found', 'Organization not found')
    )
    const response = await handleUnifiedChatPost(
      new NextRequest('http://localhost/api/mothership/chat', {
        method: 'POST',
        body: JSON.stringify({
          message: 'Find the policy',
          organizationId: 'org-1',
          mode: 'assistant',
        }),
      })
    )
    expect(response.status).toBe(403)
    expect(resolveOrCreateChat).not.toHaveBeenCalled()
    expect(createSSEStream).not.toHaveBeenCalled()
  })

  it('runs a private organization Assistant with its own billing scope and no workspace authority', async () => {
    getSession.mockResolvedValue({ user: { id: 'user-1' }, session: { id: 'session-1' } })
    const response = await handleUnifiedChatPost(
      new NextRequest('http://localhost/api/mothership/chat', {
        method: 'POST',
        body: JSON.stringify({
          message: 'Find the policy',
          organizationId: 'org-1',
          mode: 'assistant',
        }),
      })
    )
    expect(response.status).toBe(200)
    expect(authorizeOrganizationChat).toHaveBeenCalledWith({
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      input: { organizationId: 'org-1' },
    })
    expect(resolveOrCreateChat).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org-1', type: 'mothership' })
    )
    expect(getUserEntityPermissions).not.toHaveBeenCalled()
    expect(generateWorkspaceSnapshot).not.toHaveBeenCalled()
    expect(listPersonal).not.toHaveBeenCalled()
    expect(resolveBillingAttribution).not.toHaveBeenCalled()
    expect(resolveOrganizationBillingAttribution).toHaveBeenCalledWith({
      actorUserId: 'user-1',
      organizationId: 'org-1',
    })
    expect(buildCopilotRequestPayload).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org-1', mode: 'assistant', contexts: [] }),
      expect.anything()
    )
    expect(createSSEStream).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        orchestrateOptions: expect.objectContaining({
          executionContext: expect.objectContaining({
            organizationId: 'org-1',
            userId: 'user-1',
            requestMode: 'assistant',
            billingAttribution: expect.objectContaining({
              organizationId: 'org-1',
              workspaceId: null,
            }),
          }),
        }),
      })
    )
  })

  it.each([{ workspaceId: 'ws-1' }, { workflowId: 'wf-1' }, { mode: 'agent' }])(
    'rejects mixed organization scope before persistence: %j',
    async (extra) => {
      getSession.mockResolvedValue({ user: { id: 'user-1' }, session: { id: 'session-1' } })
      const response = await handleUnifiedChatPost(
        new NextRequest('http://localhost/api/mothership/chat', {
          method: 'POST',
          body: JSON.stringify({
            message: 'Find the policy',
            organizationId: 'org-1',
            mode: 'assistant',
            ...extra,
          }),
        })
      )
      expect(response.status).toBe(400)
      expect(resolveOrCreateChat).not.toHaveBeenCalled()
      expect(createSSEStream).not.toHaveBeenCalled()
    }
  )

  it('builds Assistant from only personal accounts and the selected Search scope', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([{ model: null }])
    getSession.mockResolvedValue({ user: { id: 'user-1' }, session: { id: 'session-1' } })
    listPersonal.mockResolvedValue({
      credentials: [
        {
          id: 'mine',
          providerId: 'google-drive',
          displayName: 'My Drive',
          type: 'managed_oauth',
          connectedAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'gitlab-mine',
          providerId: 'gitlab',
          displayName: 'My GitLab',
          type: 'personal_token',
          instanceUrl: 'https://gitlab.example.com',
        },
      ],
    })
    const filters = { source: 'slack', documentIds: ['doc-1'] }
    const response = await handleUnifiedChatPost(
      new NextRequest('http://localhost/api/mothership/chat', {
        method: 'POST',
        body: JSON.stringify({
          message: 'Find this',
          workspaceId: 'ws-1',
          mode: 'assistant',
          assistantSearch: filters,
          createNewChat: true,
        }),
      })
    )
    expect(response.status).toBe(200)
    expect(generateWorkspaceSnapshot).not.toHaveBeenCalled()
    expect(getEffectiveEnvironmentSnapshot).not.toHaveBeenCalled()
    expect(processContextsServer).not.toHaveBeenCalled()
    expect(computeWorkspaceEntitlements).not.toHaveBeenCalled()
    expect(listPersonal).toHaveBeenCalledWith({
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      input: { workspaceId: 'ws-1' },
    })
    expect(buildCopilotRequestPayload).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'assistant',
        assistantSearch: filters,
        contexts: [],
        workspaceContext: JSON.stringify({
          credentials: [
            { id: 'mine', providerId: 'google-drive', displayName: 'My Drive' },
            {
              id: 'gitlab-mine',
              providerId: 'gitlab',
              displayName: 'My GitLab',
              instanceUrl: 'https://gitlab.example.com',
            },
          ],
        }),
      }),
      expect.anything()
    )
    expect(createSSEStream).toHaveBeenCalledWith(
      expect.objectContaining({
        orchestrateOptions: expect.objectContaining({
          executionContext: expect.objectContaining({
            requestMode: 'assistant',
            assistantSearch: filters,
            userId: 'user-1',
          }),
        }),
      })
    )
    expect(appendCopilotChatMessages).toHaveBeenCalledWith(
      'chat-1',
      [expect.objectContaining({ requestMode: 'assistant', role: 'user' })],
      expect.anything(),
      expect.anything()
    )
  })

  it('loads personal accounts while the execution context is being prepared', async () => {
    getSession.mockResolvedValue({ user: { id: 'user-1' }, session: { id: 'session-1' } })
    const billing = Promise.withResolvers<typeof billingAttribution>()
    const accountsStarted = Promise.withResolvers<void>()
    resolveBillingAttribution.mockReturnValueOnce(billing.promise)
    listPersonal.mockImplementationOnce(async () => {
      accountsStarted.resolve()
      return { credentials: [] }
    })
    const pending = handleUnifiedChatPost(
      new NextRequest('http://localhost/api/mothership/chat', {
        method: 'POST',
        body: JSON.stringify({ message: 'Continue', workspaceId: 'ws-1', mode: 'assistant' }),
      })
    )
    await accountsStarted.promise
    expect(buildCopilotRequestPayload).not.toHaveBeenCalled()
    billing.resolve(billingAttribution)
    expect((await pending).status).toBe(200)
  })

  it.each([
    ['agent', 'assistant'],
    ['assistant', 'agent'],
  ] as const)('keeps the same chat when switching from %s to %s', async (previousMode, mode) => {
    dbChainMockFns.returning.mockResolvedValueOnce([{ model: null }])
    getSession.mockResolvedValue({ user: { id: 'user-1' }, session: { id: 'session-1' } })
    listPersonal.mockResolvedValue({ credentials: [{ id: 'mine', providerId: 'google-drive' }] })
    resolveOrCreateChat.mockResolvedValue({
      chatId: 'chat-1',
      chat: { id: 'chat-1' },
      isNew: false,
      conversationHistory: [{ role: 'user', content: 'Previous turn', requestMode: previousMode }],
    })
    const response = await handleUnifiedChatPost(
      new NextRequest('http://localhost/api/mothership/chat', {
        method: 'POST',
        body: JSON.stringify({
          message: 'Continue in this mode',
          workspaceId: 'ws-1',
          chatId: 'chat-1',
          mode,
        }),
      })
    )
    expect(response.status).toBe(200)
    expect(createSSEStream).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 'chat-1',
        isNewChat: false,
        orchestrateOptions: expect.objectContaining({
          executionContext: expect.objectContaining({ requestMode: mode }),
        }),
      })
    )
    expect(appendCopilotChatMessages).toHaveBeenCalledWith(
      'chat-1',
      [expect.objectContaining({ role: 'user', requestMode: mode })],
      expect.anything(),
      expect.anything()
    )
    if (mode === 'assistant') {
      expect(generateWorkspaceSnapshot).not.toHaveBeenCalled()
      expect(getEffectiveEnvironmentSnapshot).not.toHaveBeenCalled()
      expect(listPersonal).toHaveBeenCalledOnce()
    } else {
      expect(generateWorkspaceSnapshot).toHaveBeenCalledOnce()
      expect(getEffectiveEnvironmentSnapshot).toHaveBeenCalledOnce()
      expect(listPersonal).not.toHaveBeenCalled()
    }
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
            resolvedSecretTraceRegistry: expect.any(ResolvedSecretTraceRegistry),
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
            resolvedSecretTraceRegistry: expect.any(ResolvedSecretTraceRegistry),
          }),
        }),
      })
    )
  })

  it('persists browser page attachments as one canonical Browser panel', async () => {
    const response = await handleUnifiedChatPost(
      new NextRequest('http://localhost/api/copilot/chat', {
        method: 'POST',
        body: JSON.stringify({
          message: 'Continue in this browser',
          workspaceId: 'ws-1',
          createNewChat: true,
          resourceAttachments: [
            {
              type: 'browser',
              id: 'browser-session:slack-tab',
              title: 'mship-todo (Channel) - sim - Slack',
              active: true,
              url: 'https://app.slack.com/client/workspace/channel',
            },
            {
              type: 'browser',
              id: 'browser-session:docs-tab',
              title: 'Docs',
              url: 'https://docs.example.com',
            },
          ],
        }),
      })
    )

    expect(response.status).toBe(200)
    expect(persistChatResources).toHaveBeenCalledWith('chat-1', [
      { type: 'browser', id: 'browser-session', title: 'Browser' },
    ])
  })

  it('forwards the desktop local filesystem capability into payload construction', async () => {
    const response = await handleUnifiedChatPost(
      new NextRequest('http://localhost/api/copilot/chat', {
        method: 'POST',
        body: JSON.stringify({
          message: 'Inspect my local project',
          workspaceId: 'ws-1',
          createNewChat: true,
          desktopCapabilities: { localFilesystem: true },
        }),
      })
    )

    expect(response.status).toBe(200)
    expect(buildCopilotRequestPayload).toHaveBeenCalledWith(
      expect.objectContaining({ desktopLocalFilesystem: true }),
      { selectedModel: '' }
    )
  })

  it('accepts and forwards more than eight open terminal hints', async () => {
    const terminals = Array.from({ length: 12 }, (_, index) => ({
      id: String(index + 1),
      cwd: `/tmp/project-${index}`,
      active: index === 11,
    }))
    const response = await handleUnifiedChatPost(
      new NextRequest('http://localhost/api/copilot/chat', {
        method: 'POST',
        body: JSON.stringify({
          message: 'Inspect every open shell',
          workspaceId: 'ws-1',
          createNewChat: true,
          desktopCapabilities: { terminal: true, terminals },
        }),
      })
    )

    expect(response.status).toBe(200)
    expect(buildCopilotRequestPayload).toHaveBeenCalledWith(
      expect.objectContaining({
        terminalCapable: true,
        terminals,
      }),
      { selectedModel: '' }
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
      expect.anything(),
      expect.any(ResolvedSecretTraceRegistry)
    )
  })

  it('validates selection snapshots and omits unsafe browser source URLs', async () => {
    const response = await handleUnifiedChatPost(
      new NextRequest('http://localhost/api/copilot/chat', {
        method: 'POST',
        body: JSON.stringify({
          message: 'Explain these selections',
          workspaceId: 'ws-1',
          createNewChat: true,
          contexts: [
            {
              kind: 'browser_tab',
              tabId: 'tab-1',
              label: 'Docs',
              selection: {
                text: 'Selected documentation',
                url: 'file:///Users/example/private.html',
                title: 'Documentation',
              },
            },
            {
              kind: 'terminal_tab',
              terminalId: 'terminal-1',
              label: 'Shell',
              selection: {
                text: 'build failed',
                startLine: 12,
                endLine: 14,
              },
            },
          ],
        }),
      })
    )

    expect(response.status).toBe(200)
    expect(processContextsServer).toHaveBeenCalledWith(
      [
        {
          kind: 'browser_tab',
          tabId: 'tab-1',
          label: 'Docs',
          selection: {
            text: 'Selected documentation',
            title: 'Documentation',
          },
        },
        {
          kind: 'terminal_tab',
          terminalId: 'terminal-1',
          label: 'Shell',
          selection: {
            text: 'build failed',
            startLine: 12,
            endLine: 14,
          },
        },
      ],
      'user-1',
      'Explain these selections',
      'ws-1',
      'chat-1',
      expect.any(ResolvedSecretTraceRegistry)
    )
  })

  it('rejects invalid terminal selection line ranges', async () => {
    const response = await handleUnifiedChatPost(
      new NextRequest('http://localhost/api/copilot/chat', {
        method: 'POST',
        body: JSON.stringify({
          message: 'Explain this selection',
          workspaceId: 'ws-1',
          createNewChat: true,
          contexts: [
            {
              kind: 'terminal_tab',
              terminalId: 'terminal-1',
              label: 'Shell',
              selection: {
                text: 'build failed',
                startLine: 14,
                endLine: 12,
              },
            },
          ],
        }),
      })
    )

    expect(response.status).toBe(400)
    expect(processContextsServer).not.toHaveBeenCalled()
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

  it('keeps MCP servers tagged on earlier turns enabled for the rest of the chat', async () => {
    resolveOrCreateChat.mockResolvedValue({
      chatId: 'chat-1',
      chat: { id: 'chat-1' },
      conversationHistory: [
        {
          id: 'msg-1',
          role: 'user',
          content: '/Docs search auth',
          contexts: [{ kind: 'mcp', serverId: 'mcp-server-1', label: 'Docs' }],
        },
        { id: 'msg-2', role: 'assistant', content: 'here you go' },
      ],
      isNew: false,
    })

    const response = await handleUnifiedChatPost(
      new NextRequest('http://localhost/api/copilot/chat', {
        method: 'POST',
        body: JSON.stringify({
          message: 'now search billing',
          workspaceId: 'ws-1',
          chatId: 'chat-1',
        }),
      })
    )

    expect(response.status).toBe(200)
    expect(buildCopilotRequestPayload).toHaveBeenCalledWith(
      expect.objectContaining({ mcpServerIds: ['mcp-server-1'] }),
      { selectedModel: '' }
    )
    // The tools ride the tool array every turn, so re-expanding the listing for
    // an inherited server would only duplicate what the model already sees.
    const expandedContexts = processContextsServer.mock.calls[0]?.[0] ?? []
    expect(expandedContexts).not.toContainEqual(expect.objectContaining({ kind: 'mcp' }))
  })

  it('unions MCP servers across turns without duplicating a re-tagged server', async () => {
    resolveOrCreateChat.mockResolvedValue({
      chatId: 'chat-1',
      chat: { id: 'chat-1' },
      conversationHistory: [
        {
          id: 'msg-1',
          role: 'user',
          content: '/Docs search auth',
          contexts: [{ kind: 'mcp', serverId: 'mcp-server-1', label: 'Docs' }],
        },
      ],
      isNew: false,
    })

    const response = await handleUnifiedChatPost(
      new NextRequest('http://localhost/api/copilot/chat', {
        method: 'POST',
        body: JSON.stringify({
          message: '/Docs /Issues cross-reference',
          workspaceId: 'ws-1',
          chatId: 'chat-1',
          contexts: [
            { kind: 'mcp', serverId: 'mcp-server-1', label: 'Docs' },
            { kind: 'mcp', serverId: 'mcp-server-2', label: 'Issues' },
          ],
        }),
      })
    )

    expect(response.status).toBe(200)
    expect(buildCopilotRequestPayload).toHaveBeenCalledWith(
      expect.objectContaining({ mcpServerIds: ['mcp-server-1', 'mcp-server-2'] }),
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
    // Returns without throwing, so only a `finally` can free the claim.
    expect(releaseChatSendClaim).toHaveBeenCalled()
    await expect(response.json()).resolves.toMatchObject({
      error: 'workspaceId is required when workflowId is not provided',
    })
  })

  describe('deduplicating a repeated send', () => {
    /**
     * The client cannot tell whether a request it aborted reached the server —
     * the route never reads `request.signal`, so an accepted one runs to
     * completion regardless. Recovering such a send therefore retries it under
     * the original `userMessageId`, and this is what makes that safe.
     */
    it('answers an already-claimed send with the chat the first attempt opened', async () => {
      atomicallyClaimChatSend.mockResolvedValue({
        claimed: false,
        normalizedKey: 'chat-send:user-message:msg-1:userId=user-1',
        storageMethod: 'database',
        existingResult: { success: true, status: 'completed', result: { chatId: 'chat-first' } },
      })

      const response = await handleUnifiedChatPost(
        new NextRequest('http://localhost/api/mothership/chat', {
          method: 'POST',
          body: JSON.stringify({
            message: 'Hello',
            workspaceId: 'ws-1',
            userMessageId: 'msg-1',
            createNewChat: true,
          }),
        })
      )

      expect(response.status).toBe(409)
      await expect(response.json()).resolves.toMatchObject({
        activeStreamId: 'msg-1',
        chatId: 'chat-first',
      })
      // The whole point: no second chat, no second billed turn.
      expect(resolveOrCreateChat).not.toHaveBeenCalled()
      expect(createSSEStream).not.toHaveBeenCalled()
    })

    it('scopes the claim to the caller so one user cannot probe another', async () => {
      await handleUnifiedChatPost(
        new NextRequest('http://localhost/api/mothership/chat', {
          method: 'POST',
          body: JSON.stringify({
            message: 'Hello',
            workspaceId: 'ws-1',
            userMessageId: 'msg-1',
            createNewChat: true,
          }),
        })
      )

      expect(atomicallyClaimChatSend).toHaveBeenCalledWith('user-message', 'msg-1', {
        userId: 'user-1',
      })
    })

    it('records the chat against the send so a retry resolves to it', async () => {
      await handleUnifiedChatPost(
        new NextRequest('http://localhost/api/mothership/chat', {
          method: 'POST',
          body: JSON.stringify({
            message: 'Hello',
            workspaceId: 'ws-1',
            userMessageId: 'msg-1',
            createNewChat: true,
          }),
        })
      )

      expect(storeChatSendResult).toHaveBeenCalledWith(
        'chat-send:user-message:msg-1:userId=user-1',
        expect.objectContaining({ result: { chatId: 'chat-1' } }),
        'database',
        'claim-1'
      )
    })

    /**
     * Deduplication saves a duplicate chat; the send IS the user's message.
     * An unreachable bookkeeping store must degrade chat, never take it down.
     */
    it('sends normally when the claim store is unavailable', async () => {
      atomicallyClaimChatSend.mockRejectedValue(new Error('idempotency store down'))

      const response = await handleUnifiedChatPost(
        new NextRequest('http://localhost/api/mothership/chat', {
          method: 'POST',
          body: JSON.stringify({
            message: 'Hello',
            workspaceId: 'ws-1',
            userMessageId: 'msg-1',
            createNewChat: true,
          }),
        })
      )

      expect(response.status).toBe(200)
      expect(createSSEStream).toHaveBeenCalled()
      expect(storeChatSendResult).not.toHaveBeenCalled()
    })

    /**
     * The queued-send-handoff path deliberately retries under the original
     * `userMessageId` after a stream collision. If the collided attempt left a
     * permanent claim, that retry would deduplicate against a chat whose turn
     * never started and reattach to a stream that does not exist.
     */
    it('releases the claim when a stream collision stops the turn from starting', async () => {
      acquirePendingChatStream.mockResolvedValue(false)
      getPendingChatStreamId.mockResolvedValue('other-stream')

      const response = await handleUnifiedChatPost(
        new NextRequest('http://localhost/api/mothership/chat', {
          method: 'POST',
          body: JSON.stringify({
            message: 'Hello',
            workspaceId: 'ws-1',
            userMessageId: 'msg-1',
            createNewChat: true,
          }),
        })
      )

      expect(response.status).toBe(409)
      expect(releaseChatSendClaim).toHaveBeenCalledWith(
        'chat-send:user-message:msg-1:userId=user-1',
        'database',
        'claim-1'
      )
    })

    it('keeps the claim once a turn is actually streaming', async () => {
      const response = await handleUnifiedChatPost(
        new NextRequest('http://localhost/api/mothership/chat', {
          method: 'POST',
          body: JSON.stringify({
            message: 'Hello',
            workspaceId: 'ws-1',
            userMessageId: 'msg-1',
            createNewChat: true,
          }),
        })
      )

      expect(response.status).toBe(200)
      expect(releaseChatSendClaim).not.toHaveBeenCalled()
    })
  })
})

describe('handleUnifiedChatPost copilot.use capability gate', () => {
  const REFUSAL = "Chat is not available under your organization's permission group"
  /**
   * The body every raw capability refusal renders, detail code included. This
   * route builds it through the shared `capabilityRefusalResponse`, so a client
   * cannot tell a group refusal here apart from one raised by the funnel.
   */
  const REFUSAL_BODY = {
    error: REFUSAL,
    details: { code: 'PERMISSION_GROUP_CAPABILITY_BLOCKED' },
  }

  function chatRequest(body: Record<string, unknown> = {}) {
    return new NextRequest('http://localhost/api/copilot/chat', {
      method: 'POST',
      body: JSON.stringify({ message: 'Hello', workspaceId: 'ws-1', ...body }),
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    getSession.mockResolvedValue({ user: { id: 'user-1' } })
    atomicallyClaimChatSend.mockResolvedValue({
      claimed: true,
      normalizedKey: 'chat-send:user-message:msg-1:userId=user-1',
      storageMethod: 'database',
      claimToken: 'claim-1',
    })
    storeChatSendResult.mockResolvedValue(true)
    releaseChatSendClaim.mockResolvedValue(undefined)
    resolveWorkflowIdForUser.mockResolvedValue({
      status: 'resolved',
      workflowId: 'wf-1',
      workspaceId: 'ws-1',
      workflowName: 'Workflow One',
    })
    getUserEntityPermissions.mockResolvedValue('write')
    resolveBillingAttribution.mockResolvedValue(billingAttribution)
    resolveOrganizationBillingAttribution.mockResolvedValue({
      ...billingAttribution,
      workspaceId: null,
    })
    authorizeOrganizationChat.mockResolvedValue({
      organizationId: 'org-1',
      userId: 'user-1',
      role: 'member',
    })
    getEffectiveEnvironmentSnapshot.mockResolvedValue({
      personalEncrypted: {},
      workspaceEncrypted: {},
      personalDecrypted: {},
      workspaceDecrypted: {},
      conflicts: [],
      decryptionFailures: [],
    })
    generateWorkspaceSnapshot.mockResolvedValue({ markdown: '', snapshot: { workflows: [] } })
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
  })

  /**
   * Refused before a chat exists or a run is created, so a refused request
   * leaves nothing behind for a resume stream to replay. The send claim is
   * taken first and released by the handler's `finally`, so a retry is free to
   * start a turn.
   */
  /**
   * The capability this raw handler asserts is the one `chatOperations.send`
   * declares, not a literal restated beside it — a declarative surface would
   * enforce the declaration, and this one must agree with it.
   */
  it('enforces the capability the chat operation declares', () => {
    expect(chatOperations.send.capability).toBe('copilot.use')
  })

  it('refuses the send when the group withholds copilot.use', async () => {
    resolvePermissionGroupConfig.mockResolvedValue({
      ...DEFAULT_PERMISSION_GROUP_CONFIG,
      hideCopilot: true,
    })

    const response = await handleUnifiedChatPost(chatRequest({ createNewChat: true }))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual(REFUSAL_BODY)
    expect(resolveOrCreateChat).not.toHaveBeenCalled()
    expect(createSSEStream).not.toHaveBeenCalled()
    expect(releaseChatSendClaim).toHaveBeenCalledTimes(1)
  })

  /**
   * `workflowId` resolves the workflow's own workspace and ignores any
   * `workspaceId` beside it, so gating on the request's copy would let a member
   * skip the check entirely by simply not sending one.
   */
  it('gates on the workflow workspace when the request names no workspace', async () => {
    resolvePermissionGroupConfig.mockResolvedValue({
      ...DEFAULT_PERMISSION_GROUP_CONFIG,
      hideCopilot: true,
    })

    const response = await handleUnifiedChatPost(
      new NextRequest('http://localhost/api/copilot/chat', {
        method: 'POST',
        body: JSON.stringify({ message: 'Hello', workflowId: 'wf-1', createNewChat: true }),
      })
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual(REFUSAL_BODY)
    expect(resolvePermissionGroupConfig).toHaveBeenCalledWith('user-1', 'ws-1', undefined)
    expect(createSSEStream).not.toHaveBeenCalled()
  })

  /** The same escape aimed elsewhere: a workspace the chat never lands in. */
  it('ignores a workspaceId that disagrees with the resolved workflow workspace', async () => {
    resolvePermissionGroupConfig.mockImplementation(async (_userId: string, workspaceId: string) =>
      workspaceId === 'ws-1'
        ? { ...DEFAULT_PERMISSION_GROUP_CONFIG, hideCopilot: true }
        : DEFAULT_PERMISSION_GROUP_CONFIG
    )

    const response = await handleUnifiedChatPost(
      chatRequest({ workflowId: 'wf-1', workspaceId: 'ws-unrestricted', createNewChat: true })
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual(REFUSAL_BODY)
    expect(resolvePermissionGroupConfig).not.toHaveBeenCalledWith(
      'user-1',
      'ws-unrestricted',
      undefined
    )
    expect(createSSEStream).not.toHaveBeenCalled()
  })

  it('streams the send when a group governs the user but withholds nothing', async () => {
    resolvePermissionGroupConfig.mockResolvedValue(DEFAULT_PERMISSION_GROUP_CONFIG)

    const response = await handleUnifiedChatPost(chatRequest({ createNewChat: true }))

    expect(response.status).toBe(200)
    expect(createSSEStream).toHaveBeenCalledTimes(1)
  })

  /** A personal workspace, or any non-enterprise organization, is governed by no group. */
  it('streams the send when no permission group governs the user', async () => {
    resolvePermissionGroupConfig.mockResolvedValue(null)

    const response = await handleUnifiedChatPost(chatRequest({ createNewChat: true }))

    expect(response.status).toBe(200)
    expect(createSSEStream).toHaveBeenCalledTimes(1)
  })

  /**
   * Prompt content is exported only once the turn is going to run. GenAI
   * message capture is gated on whether capture is enabled at all, not on
   * whether this caller may send, so capturing at span start exported the
   * message of every turn the gate then refused.
   */
  it('exports no part of the prompt when the send is refused', async () => {
    resolvePermissionGroupConfig.mockResolvedValue({
      ...DEFAULT_PERMISSION_GROUP_CONFIG,
      hideCopilot: true,
    })

    const response = await handleUnifiedChatPost(chatRequest({ createNewChat: true }))

    expect(response.status).toBe(403)
    expect(setInputMessages).not.toHaveBeenCalled()
    expect(setUserMessagePreview).not.toHaveBeenCalled()
    expect(startCopilotOtelRoot).toHaveBeenCalledWith(
      expect.not.objectContaining({ userMessagePreview: expect.anything() })
    )
  })

  it('captures the prompt once the send is allowed to run', async () => {
    resolvePermissionGroupConfig.mockResolvedValue(DEFAULT_PERMISSION_GROUP_CONFIG)

    const response = await handleUnifiedChatPost(chatRequest({ createNewChat: true }))

    expect(response.status).toBe(200)
    expect(setUserMessagePreview).toHaveBeenCalledWith('Hello')
    expect(setInputMessages).toHaveBeenCalledWith({ userMessage: 'Hello' })
  })

  /** A branch that lands in no workspace at all is governed by no group. */
  it('does not consult a permission group when the branch resolves no workspace', async () => {
    resolveWorkflowIdForUser.mockResolvedValue({
      status: 'resolved',
      workflowId: 'wf-1',
      workspaceId: undefined,
      workflowName: 'Workflow One',
    })
    resolvePermissionGroupConfig.mockResolvedValue({
      ...DEFAULT_PERMISSION_GROUP_CONFIG,
      hideCopilot: true,
    })

    const response = await handleUnifiedChatPost(
      new NextRequest('http://localhost/api/copilot/chat', {
        method: 'POST',
        body: JSON.stringify({ message: 'Hello', workflowId: 'wf-1', createNewChat: true }),
      })
    )

    expect(response.status).toBe(200)
    expect(resolvePermissionGroupConfig).not.toHaveBeenCalled()
  })
})
