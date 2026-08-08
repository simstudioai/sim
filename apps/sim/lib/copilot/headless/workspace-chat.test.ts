import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAssertActiveWorkspaceAccess,
  mockBuildIntegrationToolSchemas,
  mockBuildTaggedMcpToolSchemas,
  mockComputeWorkspaceEntitlements,
  mockCreateCopilotEnvironmentContext,
  mockGenerateWorkspaceSnapshot,
  mockPrepareCopilotEnvironmentContext,
  mockProcessContextsServer,
  mockRunHeadlessCopilotLifecycle,
} = vi.hoisted(() => ({
  mockAssertActiveWorkspaceAccess: vi.fn(),
  mockBuildIntegrationToolSchemas: vi.fn(),
  mockBuildTaggedMcpToolSchemas: vi.fn(),
  mockComputeWorkspaceEntitlements: vi.fn(),
  mockCreateCopilotEnvironmentContext: vi.fn(),
  mockGenerateWorkspaceSnapshot: vi.fn(),
  mockPrepareCopilotEnvironmentContext: vi.fn(),
  mockProcessContextsServer: vi.fn(),
  mockRunHeadlessCopilotLifecycle: vi.fn(),
}))

vi.mock('@/lib/copilot/chat/payload', () => ({
  buildIntegrationToolSchemas: mockBuildIntegrationToolSchemas,
}))

vi.mock('@/lib/copilot/chat/process-contents', () => ({
  processContextsServer: mockProcessContextsServer,
}))

vi.mock('@/lib/copilot/mcp-tools', () => ({
  buildTaggedMcpToolSchemas: mockBuildTaggedMcpToolSchemas,
}))

vi.mock('@/lib/copilot/chat/workspace-context', () => ({
  generateWorkspaceSnapshot: mockGenerateWorkspaceSnapshot,
}))

vi.mock('@/lib/copilot/entitlements', () => ({
  computeWorkspaceEntitlements: mockComputeWorkspaceEntitlements,
}))

vi.mock('@/lib/copilot/environment-context', () => ({
  createCopilotEnvironmentContext: mockCreateCopilotEnvironmentContext,
  prepareCopilotEnvironmentContext: mockPrepareCopilotEnvironmentContext,
}))

vi.mock('@/lib/copilot/request/lifecycle/headless', () => ({
  runHeadlessCopilotLifecycle: mockRunHeadlessCopilotLifecycle,
}))

vi.mock('@/lib/core/config/env-flags', () => ({
  isDocSandboxEnabled: false,
  isHosted: false,
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  assertActiveWorkspaceAccess: mockAssertActiveWorkspaceAccess,
}))

import { publicChatUsageLimitMessage, runWorkspaceChat, toPublicChatResult } from './workspace-chat'

const billingAttribution = {
  actorUserId: 'billing-actor',
  workspaceId: 'workspace-1',
  organizationId: 'organization-1',
  billedAccountUserId: 'billed-account-1',
  billingEntity: { type: 'organization' as const, id: 'organization-1' },
  billingPeriod: {
    start: '2026-08-01T00:00:00.000Z',
    end: '2026-09-01T00:00:00.000Z',
  },
  payerSubscription: null,
}

describe('runWorkspaceChat', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAssertActiveWorkspaceAccess.mockResolvedValue({ permission: 'admin' })
    mockGenerateWorkspaceSnapshot.mockResolvedValue({
      markdown: 'workspace markdown',
      snapshot: { workspace: { id: 'workspace-1', name: 'Acme', ownerId: 'owner-1' } },
    })
    mockComputeWorkspaceEntitlements.mockResolvedValue(['custom-blocks'])
    mockCreateCopilotEnvironmentContext.mockResolvedValue({
      resolvedSecretTraceRegistry: { kind: 'empty-registry' },
    })
    mockPrepareCopilotEnvironmentContext.mockResolvedValue({
      resolvedSecretTraceRegistry: { kind: 'full-registry' },
    })
    mockBuildIntegrationToolSchemas.mockResolvedValue([
      { name: 'slack_send', description: 'Send Slack message', input_schema: {} },
    ])
    mockBuildTaggedMcpToolSchemas.mockResolvedValue([])
    mockProcessContextsServer.mockResolvedValue([])
    mockRunHeadlessCopilotLifecycle.mockResolvedValue({
      success: true,
      content: 'answer',
      contentBlocks: [],
      toolCalls: [],
      usage: { prompt: 12, completion: 3 },
    })
  })

  it('uses normal Mothership permissions, integrations, memory, and secrets by default', async () => {
    const userStopController = new AbortController()
    const onComplete = vi.fn()
    const onError = vi.fn()
    await runWorkspaceChat({
      prompt: 'Fix the workflow',
      authorizationUserId: 'key-owner-1',
      actorUserId: 'billing-actor',
      workspaceId: 'workspace-1',
      chatId: 'chat-1',
      messageId: 'message-1',
      requestId: 'request-1',
      executionId: 'execution-1',
      runId: 'run-1',
      billingAttribution,
      userStopSignal: userStopController.signal,
      onComplete,
      onError,
    })

    expect(mockAssertActiveWorkspaceAccess).toHaveBeenCalledWith('workspace-1', 'key-owner-1')
    expect(mockGenerateWorkspaceSnapshot).toHaveBeenCalledWith('workspace-1', 'key-owner-1', {
      workspaceAccess: { permission: 'admin' },
      secretless: false,
    })
    expect(mockPrepareCopilotEnvironmentContext).toHaveBeenCalledWith('key-owner-1', 'workspace-1')
    expect(mockCreateCopilotEnvironmentContext).not.toHaveBeenCalled()
    expect(mockBuildIntegrationToolSchemas).toHaveBeenCalledWith(
      'key-owner-1',
      'message-1',
      { schemaSurface: 'copilot' },
      'workspace-1'
    )

    const [payload, options] = mockRunHeadlessCopilotLifecycle.mock.calls[0]
    expect(payload).toMatchObject({
      message: 'Fix the workflow',
      userId: 'billing-actor',
      userPermission: 'admin',
      integrationTools: [
        { name: 'slack_send', description: 'Send Slack message', input_schema: {} },
      ],
    })
    expect(payload).not.toHaveProperty('queryOnly')
    expect(payload).not.toHaveProperty('disableUserMemory')
    expect(options).toMatchObject({
      userId: 'billing-actor',
      authorizationUserId: 'key-owner-1',
      executionId: 'execution-1',
      runId: 'run-1',
      autoCreateRunIdentity: false,
      userPermission: 'admin',
      secretActorUserId: 'key-owner-1',
      environmentContext: { resolvedSecretTraceRegistry: { kind: 'full-registry' } },
      billingAttribution,
      userStopSignal: userStopController.signal,
      onComplete,
      onError,
    })
    expect(options).not.toHaveProperty('secretMountPolicy')
  })

  it('uses the workspace-chat route with a read-only, secretless server policy', async () => {
    await runWorkspaceChat({
      prompt: 'What is deployed?',
      authorizationUserId: 'key-owner-1',
      actorUserId: 'billing-actor',
      workspaceId: 'workspace-1',
      chatId: 'chat-1',
      messageId: 'message-1',
      requestId: 'request-1',
      billingAttribution,
      readOnly: true,
    })

    expect(mockCreateCopilotEnvironmentContext).toHaveBeenCalledWith('key-owner-1', 'workspace-1', {
      personalEncrypted: {},
      workspaceEncrypted: {},
      personalDecrypted: {},
      workspaceDecrypted: {},
      personalOwners: {},
      conflicts: [],
      decryptionFailures: [],
    })
    expect(mockGenerateWorkspaceSnapshot).toHaveBeenCalledWith('workspace-1', 'key-owner-1', {
      workspaceAccess: { permission: 'admin' },
      secretless: true,
    })
    expect(mockComputeWorkspaceEntitlements).toHaveBeenCalledWith('workspace-1', 'key-owner-1')

    const [payload, options] = mockRunHeadlessCopilotLifecycle.mock.calls[0]
    expect(payload).toEqual({
      message: 'What is deployed?',
      userId: 'billing-actor',
      workspaceId: 'workspace-1',
      chatId: 'chat-1',
      messageId: 'message-1',
      mode: 'agent',
      queryOnly: true,
      disableUserMemory: true,
      workspaceContext: 'workspace markdown',
      vfs: { workspace: { id: 'workspace-1', name: 'Acme', ownerId: 'owner-1' } },
      userPermission: 'read',
      entitlements: ['custom-blocks'],
      isHosted: false,
    })
    expect(payload).not.toHaveProperty('model')
    expect(payload).not.toHaveProperty('provider')
    expect(payload).not.toHaveProperty('integrationTools')
    expect(payload).not.toHaveProperty('mothershipTools')

    expect(options).toMatchObject({
      userId: 'billing-actor',
      authorizationUserId: 'key-owner-1',
      workspaceId: 'workspace-1',
      chatId: 'chat-1',
      autoCreateRunIdentity: false,
      simRequestId: 'request-1',
      goRoute: '/api/mothership/v2-chat',
      resumeRoute: '/api/tools/v2-chat/resume',
      autoExecuteTools: true,
      interactive: false,
      billingAttribution,
      userPermission: 'read',
      secretActorUserId: null,
      secretMountPolicy: { secretScope: 'selected', mountedSecrets: [] },
      environmentContext: { resolvedSecretTraceRegistry: { kind: 'empty-registry' } },
    })
  })

  it('resolves structured tags and exposes only explicitly tagged MCP tools', async () => {
    const contexts = [
      { kind: 'workflow' as const, workflowId: 'workflow-1', label: 'Release' },
      { kind: 'skill' as const, skillId: 'skill-1', label: 'review' },
      { kind: 'mcp' as const, serverId: 'mcp-1', label: 'Docs' },
    ]
    mockProcessContextsServer.mockResolvedValueOnce([
      { type: 'workflow', content: '', path: 'workflows/release', tag: '@Release' },
      { type: 'skill', content: 'Review carefully', tag: '/review' },
    ])
    mockBuildTaggedMcpToolSchemas.mockResolvedValueOnce([
      { name: 'mcp_docs_search', description: 'Search docs', input_schema: {} },
    ])

    await runWorkspaceChat({
      prompt: 'Use @Release and /review with /Docs',
      authorizationUserId: 'key-owner-1',
      actorUserId: 'billing-actor',
      workspaceId: 'workspace-1',
      chatId: 'chat-1',
      messageId: 'message-1',
      requestId: 'request-1',
      billingAttribution,
      contexts,
    })

    expect(mockProcessContextsServer).toHaveBeenCalledWith(
      contexts,
      'key-owner-1',
      'Use @Release and /review with /Docs',
      'workspace-1',
      'chat-1'
    )
    expect(mockBuildTaggedMcpToolSchemas).toHaveBeenCalledWith('key-owner-1', 'workspace-1', [
      'mcp-1',
    ])
    expect(mockRunHeadlessCopilotLifecycle.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        context: [
          { type: 'workflow', content: '', path: 'workflows/release', tag: '@Release' },
          { type: 'skill', content: 'Review carefully', tag: '/review' },
        ],
        mothershipTools: [
          { name: 'mcp_docs_search', description: 'Search docs', input_schema: {} },
        ],
      })
    )
  })

  it('unions inherited MCP ids with this turn while expanding only explicit contexts', async () => {
    const contexts = [
      { kind: 'skill' as const, skillId: 'skill-1', label: 'review' },
      { kind: 'mcp' as const, serverId: 'mcp-current', label: 'Current' },
    ]

    await runWorkspaceChat({
      prompt: 'Continue with /review and /Current',
      authorizationUserId: 'key-owner-1',
      actorUserId: 'billing-actor',
      workspaceId: 'workspace-1',
      chatId: 'chat-1',
      messageId: 'message-1',
      requestId: 'request-1',
      billingAttribution,
      contexts,
      mcpServerIds: ['mcp-history', 'mcp-current'],
    })

    expect(mockProcessContextsServer).toHaveBeenCalledWith(
      contexts,
      'key-owner-1',
      'Continue with /review and /Current',
      'workspace-1',
      'chat-1'
    )
    expect(mockBuildTaggedMcpToolSchemas).toHaveBeenCalledWith('key-owner-1', 'workspace-1', [
      'mcp-history',
      'mcp-current',
    ])
  })

  it('drops MCP contexts and tools from secretless requests', async () => {
    const workflow = {
      kind: 'workflow' as const,
      workflowId: 'workflow-1',
      label: 'Release',
    }
    await runWorkspaceChat({
      prompt: 'Inspect @Release with /Docs',
      authorizationUserId: 'key-owner-1',
      actorUserId: 'billing-actor',
      workspaceId: 'workspace-1',
      chatId: 'chat-1',
      messageId: 'message-1',
      requestId: 'request-1',
      billingAttribution,
      readOnly: true,
      contexts: [workflow, { kind: 'mcp', serverId: 'mcp-1', label: 'Docs' }],
      mcpServerIds: ['mcp-history'],
    })

    expect(mockProcessContextsServer).toHaveBeenCalledWith(
      [workflow],
      'key-owner-1',
      'Inspect @Release with /Docs',
      'workspace-1',
      'chat-1'
    )
    expect(mockBuildTaggedMcpToolSchemas).not.toHaveBeenCalled()
    expect(mockRunHeadlessCopilotLifecycle.mock.calls[0][0]).not.toHaveProperty('mothershipTools')
  })

  it('keeps shared workspace credentials out of personal environment, integrations, and memory', async () => {
    await runWorkspaceChat({
      prompt: 'Fix the workflow',
      authorizationUserId: 'key-owner-1',
      actorUserId: 'billing-actor',
      workspaceId: 'workspace-1',
      chatId: 'chat-1',
      messageId: 'message-1',
      requestId: 'request-1',
      billingAttribution,
      sharedWorkspaceCredential: true,
    })

    expect(mockPrepareCopilotEnvironmentContext).not.toHaveBeenCalled()
    expect(mockCreateCopilotEnvironmentContext).toHaveBeenCalledWith('key-owner-1', 'workspace-1', {
      personalEncrypted: {},
      workspaceEncrypted: {},
      personalDecrypted: {},
      workspaceDecrypted: {},
      personalOwners: {},
      conflicts: [],
      decryptionFailures: [],
    })
    expect(mockBuildIntegrationToolSchemas).not.toHaveBeenCalled()
    expect(mockGenerateWorkspaceSnapshot).toHaveBeenCalledWith('workspace-1', 'key-owner-1', {
      workspaceAccess: { permission: 'admin' },
      secretless: true,
    })

    const [payload, options] = mockRunHeadlessCopilotLifecycle.mock.calls[0]
    expect(payload).toMatchObject({
      userId: 'billing-actor',
      userPermission: 'admin',
      disableUserMemory: true,
    })
    expect(payload).not.toHaveProperty('queryOnly')
    expect(payload).not.toHaveProperty('integrationTools')
    expect(options).toMatchObject({
      userId: 'billing-actor',
      authorizationUserId: 'key-owner-1',
      secretActorUserId: null,
      secretMountPolicy: { secretScope: 'selected', mountedSecrets: [] },
      environmentContext: { resolvedSecretTraceRegistry: { kind: 'empty-registry' } },
    })
  })

  it('authorizes before reading workspace context or resolving runtime state', async () => {
    let resolveAccess: ((value: { permission: string }) => void) | undefined
    mockAssertActiveWorkspaceAccess.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveAccess = resolve
        })
    )

    const pending = runWorkspaceChat({
      prompt: 'Fix the workflow',
      authorizationUserId: 'key-owner-1',
      actorUserId: 'billing-actor',
      workspaceId: 'workspace-1',
      chatId: 'chat-1',
      messageId: 'message-1',
      requestId: 'request-1',
      billingAttribution,
    })

    expect(mockGenerateWorkspaceSnapshot).not.toHaveBeenCalled()
    expect(mockComputeWorkspaceEntitlements).not.toHaveBeenCalled()
    expect(mockPrepareCopilotEnvironmentContext).not.toHaveBeenCalled()
    expect(mockBuildIntegrationToolSchemas).not.toHaveBeenCalled()

    resolveAccess?.({ permission: 'admin' })
    await pending
  })

  it('does not start the Go leg when cancellation wins during workspace preparation', async () => {
    const abortController = new AbortController()
    let resolveSnapshot!: (value: {
      markdown: string
      snapshot: { workspace: { id: string; name: string; ownerId: string } }
    }) => void
    mockGenerateWorkspaceSnapshot.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSnapshot = resolve
      })
    )

    const pending = runWorkspaceChat({
      prompt: 'Fix the workflow',
      authorizationUserId: 'key-owner-1',
      actorUserId: 'billing-actor',
      workspaceId: 'workspace-1',
      chatId: 'chat-1',
      messageId: 'message-1',
      requestId: 'request-1',
      billingAttribution,
      abortSignal: abortController.signal,
    })
    await vi.waitFor(() => expect(mockGenerateWorkspaceSnapshot).toHaveBeenCalledTimes(1))

    abortController.abort('test cancellation')
    resolveSnapshot({
      markdown: 'workspace markdown',
      snapshot: { workspace: { id: 'workspace-1', name: 'Acme', ownerId: 'owner-1' } },
    })

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(mockRunHeadlessCopilotLifecycle).not.toHaveBeenCalled()
  })

  it('fails rather than asking without a workspace snapshot', async () => {
    mockGenerateWorkspaceSnapshot.mockResolvedValueOnce(null)

    await expect(
      runWorkspaceChat({
        prompt: 'hello',
        authorizationUserId: 'key-owner-1',
        actorUserId: 'billing-actor',
        workspaceId: 'workspace-1',
        chatId: 'chat-1',
        messageId: 'message-1',
        requestId: 'request-1',
        billingAttribution,
        readOnly: true,
      })
    ).rejects.toThrow('Workspace context is unavailable')
    expect(mockRunHeadlessCopilotLifecycle).not.toHaveBeenCalled()
  })

  it('passes validated inline attachments without exposing storage paths or URLs', async () => {
    const fileAttachments = [
      {
        type: 'document' as const,
        filename: 'notes.txt',
        source: {
          type: 'base64' as const,
          media_type: 'text/plain',
          data: 'aGk=',
        },
      },
    ]

    await runWorkspaceChat({
      prompt: 'Read this',
      authorizationUserId: 'key-owner-1',
      actorUserId: 'billing-actor',
      workspaceId: 'workspace-1',
      chatId: 'chat-1',
      messageId: 'message-1',
      requestId: 'request-1',
      billingAttribution,
      readOnly: true,
      fileAttachments,
    })

    expect(mockRunHeadlessCopilotLifecycle.mock.calls[0][0]).toEqual(
      expect.objectContaining({ fileAttachments })
    )
  })
})

describe('toPublicChatResult', () => {
  it('exposes only final content, opaque continuation token, and token usage', () => {
    expect(
      toPublicChatResult(
        {
          success: true,
          content: 'answer',
          contentBlocks: [{ type: 'thinking', content: 'private', timestamp: 1 }],
          toolCalls: [{ id: 'tool-1', name: 'read', status: 'success' }],
          usage: { prompt: 12, completion: 3 },
          cost: { input: 1, output: 2, total: 3 },
        },
        'continuation-token-1'
      )
    ).toEqual({
      content: 'answer',
      continuationToken: 'continuation-token-1',
      usage: { prompt: 12, completion: 3, total: 15 },
    })
  })
})

describe('publicChatUsageLimitMessage', () => {
  it('turns the interactive upgrade tag back into a public error message', () => {
    expect(
      publicChatUsageLimitMessage(
        '<usage_upgrade>{"reason":"usage_limit","action":"increase_limit","message":"Ask an org admin."}</usage_upgrade>'
      )
    ).toBe('Ask an org admin.')
    expect(publicChatUsageLimitMessage('<usage_upgrade>bad json</usage_upgrade>')).toBe(
      'Usage limit exceeded'
    )
    expect(publicChatUsageLimitMessage('ordinary answer')).toBeNull()
  })
})
