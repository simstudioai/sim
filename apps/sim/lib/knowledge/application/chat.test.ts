/** @vitest-environment node */
import type { OAuthAccessTokenPrincipal, Principal } from '@sim/auth/principal'
import { dbChainMockFns, resetDbChainMock, schemaMock } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CopilotLifecycleOptions } from '@/lib/copilot/request/lifecycle/run'
import type { OrchestratorResult, ToolCallSummary } from '@/lib/copilot/request/types'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const mocks = vi.hoisted(() => ({
  available: vi.fn(),
  billing: vi.fn(),
  config: vi.fn(),
  lifecycle: vi.fn(),
  persist: vi.fn(),
  explicitAbort: vi.fn(),
}))

vi.mock('@/lib/knowledge/access/availability', () => ({
  requireOrganizationSearchAvailable: mocks.available,
}))
vi.mock('@/lib/permission-groups/resolve.server', () => ({
  getUserPermissionConfigForOrganization: mocks.config,
}))
vi.mock('@/lib/billing/core/billing-attribution', () => ({
  resolveOrganizationBillingAttribution: mocks.billing,
}))
vi.mock('@/lib/copilot/request/lifecycle/run', () => ({
  runCopilotLifecycle: mocks.lifecycle,
}))
vi.mock('@/lib/copilot/chat/messages-store', () => ({
  persistCopilotChatTurn: mocks.persist,
}))
vi.mock('@/lib/copilot/request/session/explicit-abort', () => ({
  requestExplicitStreamAbort: mocks.explicitAbort,
}))
vi.mock('@/lib/core/utils/urls', () => ({ getBaseUrl: () => 'https://sim.example' }))

import { organizationSearchChat } from '@/lib/knowledge/application/chat'
import { resolveSearchChatCitations } from '@/lib/knowledge/application/chat-citations'
import { organizationSearchChatOperation } from '@/lib/knowledge/application/chat-operations'

const principal: OAuthAccessTokenPrincipal = {
  kind: 'oauth_access_token',
  userId: 'member-1',
  clientId: 'mcp-client',
  tokenId: 'oauth-token-id',
  scopes: ['search:read'],
  expiresAt: new Date('2099-01-01'),
}

function createResult(overrides: Partial<OrchestratorResult> = {}): OrchestratorResult {
  return {
    success: true,
    content: 'The field kit is in the violet suitcase.',
    contentBlocks: [],
    toolCalls: [],
    ...overrides,
  }
}

function execute(
  overrides: Partial<Parameters<typeof organizationSearchChat.execute>[0]['input']> = {},
  caller: Principal = principal
) {
  return organizationSearchChat.execute({
    principal: caller,
    input: {
      organizationId: 'org-1',
      query: 'Where is the field kit?',
      resultSecretRegistry: new ResolvedSecretTraceRegistry(),
      ...overrides,
    },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  resetDbChainMock()
  dbChainMockFns.limit.mockResolvedValue([{ role: 'member' }])
  dbChainMockFns.returning.mockResolvedValue([{ id: 'private-chat' }])
  dbChainMockFns.for.mockResolvedValue([{ id: 'private-chat' }])
  mocks.config.mockResolvedValue(null)
  mocks.available.mockResolvedValue(undefined)
  mocks.billing.mockResolvedValue({
    actorUserId: 'member-1',
    organizationId: 'org-1',
    workspaceId: null,
    billedAccountUserId: 'different-billing-owner',
  })
  mocks.lifecycle.mockResolvedValue(createResult())
  mocks.persist.mockResolvedValue(undefined)
  mocks.explicitAbort.mockResolvedValue(undefined)
})

afterEach(() => vi.useRealTimers())

describe('organization Search Assistant chat', () => {
  it('uses Search consent and the real organization Assistant through the headless lifecycle', async () => {
    const registry = new ResolvedSecretTraceRegistry()
    const filters = { source: 'google_drive', documentIds: ['document-1'] }
    const result = await execute({ resultSecretRegistry: registry, filters })

    expect(organizationSearchChat.operation).toBe(organizationSearchChatOperation)
    expect(organizationSearchChatOperation).toMatchObject({
      id: 'knowledge.chat',
      oauthScope: 'search:read',
      capability: 'copilot.use',
      minimumRole: 'member',
    })
    expect(mocks.lifecycle).toHaveBeenCalledOnce()
    const [payload, options] = mocks.lifecycle.mock.calls[0]
    expect(payload).toEqual({
      messages: [{ role: 'user', content: 'Where is the field kit?' }],
      messageId: expect.any(String),
      userId: 'member-1',
      organizationId: 'org-1',
      chatId: 'private-chat',
      mode: 'assistant',
      assistantSearch: filters,
      isHosted: expect.any(Boolean),
    })
    expect(options).toMatchObject({
      userId: 'member-1',
      organizationId: 'org-1',
      chatId: 'private-chat',
      goRoute: '/api/mothership/execute',
      interactive: false,
      autoExecuteTools: true,
      secretActorUserId: null,
      resolvedSecretTraceRegistry: registry,
      billingAttribution: {
        actorUserId: 'member-1',
        billedAccountUserId: 'different-billing-owner',
      },
      trace: expect.any(Object),
      otelContext: expect.any(Object),
    })
    expect(options).not.toHaveProperty('workspaceId')
    expect(options).not.toHaveProperty('workflowId')
    expect(options).not.toHaveProperty('environmentContext')
    expect(payload).not.toHaveProperty('integrationTools')
    expect(payload).not.toHaveProperty('workspaceContext')
    expect(mocks.billing).toHaveBeenCalledWith({ actorUserId: 'member-1', organizationId: 'org-1' })
    expect(result).toEqual({
      content: 'The field kit is in the violet suitcase.',
      citations: [],
      chatId: 'private-chat',
      conversationUrl: 'https://sim.example/o/org-1/chat/private-chat',
    })
    expect(mocks.persist).toHaveBeenCalledWith('private-chat', [
      expect.objectContaining({ role: 'user', requestMode: 'assistant' }),
      expect.objectContaining({ role: 'assistant', requestMode: 'assistant' }),
    ])
    expect(dbChainMockFns.limit).toHaveBeenCalledTimes(2)
    expect(mocks.available).toHaveBeenCalledTimes(2)
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it.each<Principal>([
    { kind: 'session', userId: 'member-1', sessionId: 'session-1' },
    { kind: 'personal_api_key', userId: 'member-1', keyId: 'personal-key' },
  ])('keeps the real $kind caller as the actor', async (caller) => {
    await execute({}, caller)
    expect(mocks.lifecycle.mock.calls[0][1].userId).toBe(caller.userId)
  })

  it.each<Principal>([
    { ...principal, scopes: [] },
    { ...principal, expiresAt: new Date('2020-01-01') },
    { kind: 'workspace_api_key', keyId: 'workspace-key', workspaceId: 'workspace-1' },
  ])('rejects unauthorized credentials before protected work', async (caller) => {
    await expect(execute({}, caller)).rejects.toThrow()
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
    expect(mocks.billing).not.toHaveBeenCalled()
    expect(mocks.lifecycle).not.toHaveBeenCalled()
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('does not create a conversation for a nonmember', async () => {
    dbChainMockFns.limit.mockResolvedValue([])
    await expect(execute()).rejects.toThrow('Organization not found')
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
    expect(mocks.config).not.toHaveBeenCalled()
  })

  it.each(['hideCopilot', 'disableOAuthAppAccess', 'disablePersonalApiKeys'] as const)(
    'enforces the organization %s policy',
    async (key) => {
      mocks.config.mockResolvedValue({ ...DEFAULT_PERMISSION_GROUP_CONFIG, [key]: true })
      await expect(execute()).rejects.toThrow()
      expect(mocks.lifecycle).not.toHaveBeenCalled()
      expect(dbChainMockFns.insert).not.toHaveBeenCalled()
    }
  )

  it('checks the organization Search flag before creating or billing a conversation', async () => {
    mocks.available.mockRejectedValue(new OrchestrationError('forbidden', 'Search is not enabled'))
    await expect(execute()).rejects.toThrow('Search is not enabled')
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
    expect(mocks.billing).not.toHaveBeenCalled()
  })

  it.each(['', ' ', 'x'.repeat(8193)])('rejects an invalid question', async (query) => {
    await expect(execute({ query })).rejects.toThrow('question')
    expect(mocks.billing).not.toHaveBeenCalled()
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })

  it('refuses invalid filter dates before sending model input', async () => {
    await expect(execute({ filters: { modifiedAfter: 'yesterday' } })).rejects.toThrow()
    expect(mocks.lifecycle).not.toHaveBeenCalled()
  })

  it('fails closed when input provenance is incomplete', async () => {
    const registry = new ResolvedSecretTraceRegistry()
    registry.markIncomplete('untrusted-provenance')
    await expect(execute({ resultSecretRegistry: registry })).rejects.toThrow('protected content')
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })

  it('creates a new private conversation for each call', async () => {
    dbChainMockFns.returning
      .mockResolvedValueOnce([{ id: 'first-chat' }])
      .mockResolvedValueOnce([{ id: 'second-chat' }])
    const first = await execute()
    const second = await execute()
    expect(first.chatId).toBe('first-chat')
    expect(second.chatId).toBe('second-chat')
    expect(dbChainMockFns.values).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'member-1',
        organizationId: 'org-1',
        type: 'mothership',
        title: 'Where is the field kit?',
      })
    )
  })

  it('withholds the answer when organization membership is revoked during execution', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ role: 'member' }]).mockResolvedValueOnce([])
    await expect(execute()).rejects.toThrow('Organization not found')
    expect(mocks.lifecycle).toHaveBeenCalledOnce()
    expect(mocks.persist).not.toHaveBeenCalled()
    expect(dbChainMockFns.update).toHaveBeenCalledOnce()
  })

  it('rechecks OAuth restrictions after the run', async () => {
    mocks.config.mockResolvedValueOnce(null).mockResolvedValueOnce({
      ...DEFAULT_PERMISSION_GROUP_CONFIG,
      disableOAuthAppAccess: true,
    })
    await expect(execute()).rejects.toThrow('OAuth app access')
    expect(mocks.persist).not.toHaveBeenCalled()
    expect(dbChainMockFns.update).toHaveBeenCalledOnce()
  })

  it('withholds the answer when Search is disabled during execution', async () => {
    mocks.available
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new OrchestrationError('forbidden', 'Search is not enabled'))
    await expect(execute()).rejects.toThrow('Search is not enabled')
    expect(mocks.persist).not.toHaveBeenCalled()
    expect(dbChainMockFns.update).toHaveBeenCalledOnce()
  })

  it.each([
    { success: false, error: 'private backend diagnostic', content: 'partial answer' },
    { success: true, cancelled: true },
    { success: true, content: '' },
  ])('does not expose failed, cancelled, or empty answers', async (overrides) => {
    mocks.lifecycle.mockResolvedValue(createResult(overrides))
    await expect(execute()).rejects.toThrow(/assistant/i)
    expect(mocks.persist).not.toHaveBeenCalled()
    expect(dbChainMockFns.update).toHaveBeenCalledOnce()
  })

  it('fails closed when retrieval makes provenance incomplete', async () => {
    const registry = new ResolvedSecretTraceRegistry()
    mocks.lifecycle.mockImplementation(async () => {
      registry.markIncomplete('untrusted-provenance')
      return createResult()
    })
    await expect(execute({ resultSecretRegistry: registry })).rejects.toThrow('safely')
    expect(mocks.persist).not.toHaveBeenCalled()
  })

  it('returns the answer without a broken conversation link when persistence fails', async () => {
    mocks.persist.mockRejectedValue(new Error('database unavailable'))
    await expect(execute()).resolves.toEqual({ content: createResult().content, citations: [] })
    expect(dbChainMockFns.update).toHaveBeenCalledOnce()
  })

  it('only archives its own newly created conversation when it has no persisted messages', async () => {
    mocks.lifecycle.mockRejectedValue(new Error('model unavailable'))
    await expect(execute()).rejects.toThrow('model unavailable')
    expect(dbChainMockFns.transaction).toHaveBeenCalledOnce()
    expect(dbChainMockFns.for).toHaveBeenCalledWith('update')
    expect(dbChainMockFns.for.mock.invocationCallOrder[0]).toBeLessThan(
      dbChainMockFns.update.mock.invocationCallOrder[0]
    )
    expect(dbChainMockFns.update).toHaveBeenCalledWith(schemaMock.copilotChats)
    expect(dbChainMockFns.set).toHaveBeenCalledWith({ deletedAt: expect.any(Date) })
    expect(dbChainMockFns.where).toHaveBeenLastCalledWith({
      type: 'and',
      conditions: [
        {
          type: 'and',
          conditions: [
            { type: 'eq', left: schemaMock.copilotChats.id, right: 'private-chat' },
            { type: 'eq', left: schemaMock.copilotChats.userId, right: 'member-1' },
            { type: 'eq', left: schemaMock.copilotChats.organizationId, right: 'org-1' },
            { type: 'isNull', column: schemaMock.copilotChats.deletedAt },
          ],
        },
        expect.objectContaining({ type: 'notExists' }),
      ],
    })
    expect(dbChainMockFns.from).toHaveBeenCalledWith(schemaMock.copilotMessages)
    expect(dbChainMockFns.where).toHaveBeenCalledWith({
      type: 'eq',
      left: schemaMock.copilotMessages.chatId,
      right: 'private-chat',
    })
  })

  it('preserves a completed transcript if cancellation arrives during persistence', async () => {
    const controller = new AbortController()
    mocks.persist.mockImplementation(async () => controller.abort())
    await expect(execute({ signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(mocks.persist).toHaveBeenCalledOnce()
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('preserves the original failure when cleanup cannot reach the database', async () => {
    mocks.lifecycle.mockRejectedValue(new Error('model unavailable'))
    dbChainMockFns.update.mockImplementationOnce(() => {
      throw new Error('database unavailable')
    })
    await expect(execute()).rejects.toThrow('model unavailable')
  })

  it('does not change a chat that no longer matches the owned live row lock', async () => {
    mocks.lifecycle.mockRejectedValue(new Error('model unavailable'))
    dbChainMockFns.for.mockResolvedValueOnce([])
    await expect(execute()).rejects.toThrow('model unavailable')
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('does not start or bill work for an already-cancelled request', async () => {
    await expect(execute({ signal: AbortSignal.abort() })).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(mocks.billing).not.toHaveBeenCalled()
    expect(mocks.lifecycle).not.toHaveBeenCalled()
  })

  it('forwards cancellation and explicitly stops the same actor’s remote stream', async () => {
    const controller = new AbortController()
    let start: () => void = () => {}
    const started = new Promise<void>((resolve) => {
      start = resolve
    })
    mocks.lifecycle.mockImplementation(
      (_payload: unknown, options: CopilotLifecycleOptions) =>
        new Promise<OrchestratorResult>((resolve) => {
          options.abortSignal?.addEventListener(
            'abort',
            () => resolve(createResult({ cancelled: true })),
            { once: true }
          )
          start()
        })
    )
    const pending = execute({ signal: controller.signal })
    const refusal = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await started
    controller.abort()
    await refusal
    expect(mocks.explicitAbort).toHaveBeenCalledWith({
      streamId: expect.any(String),
      userId: 'member-1',
      organizationId: 'org-1',
      chatId: 'private-chat',
    })
    expect(mocks.explicitAbort).toHaveBeenCalledOnce()
    expect(mocks.persist).not.toHaveBeenCalled()
    expect(dbChainMockFns.update).toHaveBeenCalledOnce()
  })

  it('caps execution time and removes the timeout after completion', async () => {
    vi.useFakeTimers()
    mocks.lifecycle.mockImplementation(
      (_payload: unknown, options: CopilotLifecycleOptions) =>
        new Promise<OrchestratorResult>((resolve) => {
          options.abortSignal?.addEventListener(
            'abort',
            () => resolve(createResult({ cancelled: true })),
            { once: true }
          )
        })
    )
    const refusal = expect(execute()).rejects.toMatchObject({ name: 'AbortError' })
    await vi.advanceTimersByTimeAsync(180_000)
    await refusal
    expect(mocks.explicitAbort).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
    expect(dbChainMockFns.update).toHaveBeenCalledOnce()
  })
})

describe('Search Assistant citations', () => {
  const citation = {
    citationId: 'document:one',
    citationUrl: 'https://docs.example/one',
    documentName: 'Field kit',
  }
  function tool(result: unknown, overrides: Partial<ToolCallSummary> = {}): ToolCallSummary {
    return { id: 'tool-1', name: 'search_workspace', status: 'success', result, ...overrides }
  }

  it('uses the exact retrieved source and deduplicates repeated references', () => {
    const tag = '<source>{"id":"document:one","url":"https://invented.example"}</source>'
    expect(
      resolveSearchChatCitations(`Violet ${tag} Again ${tag}`, [
        tool({ success: true, data: { results: [citation] } }),
      ])
    ).toEqual({
      content: 'Violet [1](<https://docs.example/one>) Again [1](<https://docs.example/one>)',
      citations: [{ id: 'document:one', url: 'https://docs.example/one', title: 'Field kit' }],
    })
  })

  it('accepts read_document evidence and JSON-encoded tool results', () => {
    expect(
      resolveSearchChatCitations('<source>{"id":"document:one"}</source>', [
        tool(JSON.stringify({ data: citation }), { name: 'read_document' }),
      ]).citations
    ).toHaveLength(1)
  })

  it.each([
    tool({ data: citation }, { status: 'error' }),
    tool({ success: false, data: citation }),
    tool({ data: citation }, { name: 'web_search' }),
    tool({ data: { ...citation, citationUrl: 'javascript:alert(1)' } }),
    tool({ data: { ...citation, citationUrl: 'https://user:password@docs.example' } }),
  ])('does not cite failed, unrelated, or unsafe evidence', (result) => {
    expect(
      resolveSearchChatCitations('Violet <source>{"id":"document:one"}</source>', [result])
    ).toEqual({ content: 'Violet ', citations: [] })
  })

  it('removes missing and malformed citations without manufacturing evidence', () => {
    expect(
      resolveSearchChatCitations(
        'A<source>bad json</source>B<source>{"id":"missing"}</source>C<source>{"url":"https://invented.example"}</source>',
        []
      )
    ).toEqual({ content: 'ABC', citations: [] })
  })
})
