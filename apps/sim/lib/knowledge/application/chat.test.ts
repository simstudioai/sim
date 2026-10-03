import type { OAuthAccessTokenPrincipal, Principal } from '@sim/auth/principal'
import { dbChainMockFns, resetDbChainMock, schemaMock } from '@sim/testing'
import { createWorkspaceApiKeyPrincipal } from '@sim/testing/factories/principal.factory'
import {
  billingAttributionMock,
  billingAttributionMockFns,
} from '@sim/testing/mocks/billing-attribution.mock'
import {
  knowledgeAvailabilityMock,
  knowledgeAvailabilityMockFns,
} from '@sim/testing/mocks/knowledge-availability.mock'
import {
  mothershipChatMessagesMock,
  mothershipChatMessagesMockFns,
} from '@sim/testing/mocks/mothership-chat-messages.mock'
import {
  permissionGroupsResolveMock,
  permissionGroupsResolveMockFns,
} from '@sim/testing/mocks/permission-groups-resolve.mock'
import { urlsMockFns } from '@sim/testing/mocks/urls.mock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { OrchestratorResult, ToolCallSummary } from '@/lib/mothership/request/types'
import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const mocks = vi.hoisted(() => ({
  inventory: vi.fn(),
  lifecycle: vi.fn(),
  explicitAbort: vi.fn(),
}))

vi.mock('@/lib/mothership/application/load-search-integrations', () => ({
  loadCopilotSearchIntegrations: mocks.inventory,
}))
vi.mock('@/lib/knowledge/access/availability', () => knowledgeAvailabilityMock)
vi.mock('@/lib/permission-groups/resolve.server', () => permissionGroupsResolveMock)
vi.mock('@/lib/billing/core/billing-attribution', () => billingAttributionMock)
vi.mock('@/lib/mothership/request/lifecycle/run', () => ({
  runCopilotLifecycle: mocks.lifecycle,
}))
vi.mock('@/lib/mothership/chat/messages-store', () => mothershipChatMessagesMock)
vi.mock('@/lib/mothership/request/session/explicit-abort', () => ({
  requestExplicitStreamAbort: mocks.explicitAbort,
}))

import { organizationSearchChat } from '@/lib/knowledge/application/chat'
import { resolveSearchChatCitations } from '@/lib/knowledge/application/chat-citations'

const persistTurn = mothershipChatMessagesMockFns.mockPersistCopilotChatTurn

urlsMockFns.mockGetBaseUrl.mockReturnValue('https://sim.example')

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
  resetDbChainMock()
  dbChainMockFns.limit.mockResolvedValue([{ role: 'member' }])
  dbChainMockFns.returning.mockResolvedValue([{ id: 'private-chat' }])
  dbChainMockFns.for.mockResolvedValue([{ id: 'private-chat' }])
  permissionGroupsResolveMockFns.mockGetUserPermissionConfigForOrganization.mockResolvedValue(null)
  knowledgeAvailabilityMockFns.mockRequireOrganizationSearchAvailable.mockResolvedValue(undefined)
  mocks.inventory.mockResolvedValue('{"connections":[],"available":[]}')
  billingAttributionMockFns.mockResolveOrganizationBillingAttribution.mockResolvedValue({
    actorUserId: 'member-1',
    organizationId: 'org-1',
    workspaceId: null,
    billedAccountUserId: 'different-billing-owner',
  })
  mocks.lifecycle.mockResolvedValue(createResult())
  persistTurn.mockResolvedValue(undefined)
  mocks.explicitAbort.mockResolvedValue(undefined)
})

afterEach(() => vi.useRealTimers())

describe('organization Search Assistant chat', () => {
  it('does not dispatch if authorized source inventory cannot be loaded', async () => {
    mocks.inventory.mockRejectedValueOnce(new Error('Inventory unavailable'))
    await expect(execute()).rejects.toThrow('Inventory unavailable')
    expect(mocks.lifecycle).not.toHaveBeenCalled()
  })

  it.each<Principal>([
    { ...principal, scopes: [] },
    { ...principal, expiresAt: new Date('2020-01-01') },
    createWorkspaceApiKeyPrincipal({ keyId: 'workspace-key' }),
  ])('rejects unauthorized credentials before protected work', async (caller) => {
    await expect(execute({}, caller)).rejects.toThrow()
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
    expect(
      billingAttributionMockFns.mockResolveOrganizationBillingAttribution
    ).not.toHaveBeenCalled()
    expect(mocks.lifecycle).not.toHaveBeenCalled()
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('does not create a conversation for a nonmember', async () => {
    dbChainMockFns.limit.mockResolvedValue([])
    await expect(execute()).rejects.toThrow('Organization not found')
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
    expect(
      permissionGroupsResolveMockFns.mockGetUserPermissionConfigForOrganization
    ).not.toHaveBeenCalled()
  })

  it.each(['hideCopilot', 'disableOAuthAppAccess', 'disablePersonalApiKeys'] as const)(
    'enforces the organization %s policy',
    async (key) => {
      permissionGroupsResolveMockFns.mockGetUserPermissionConfigForOrganization.mockResolvedValue({
        ...DEFAULT_PERMISSION_GROUP_CONFIG,
        [key]: true,
      })
      await expect(execute()).rejects.toThrow()
      expect(mocks.lifecycle).not.toHaveBeenCalled()
      expect(dbChainMockFns.insert).not.toHaveBeenCalled()
    }
  )

  it('checks the organization Search flag before creating or billing a conversation', async () => {
    knowledgeAvailabilityMockFns.mockRequireOrganizationSearchAvailable.mockRejectedValue(
      new OrchestrationError('forbidden', 'Search is not enabled')
    )
    await expect(execute()).rejects.toThrow('Search is not enabled')
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
    expect(
      billingAttributionMockFns.mockResolveOrganizationBillingAttribution
    ).not.toHaveBeenCalled()
  })

  it('fails closed when input provenance is incomplete', async () => {
    const registry = new ResolvedSecretTraceRegistry()
    registry.markIncomplete('untrusted-provenance')
    await expect(execute({ resultSecretRegistry: registry })).rejects.toThrow('protected content')
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })

  it('withholds the answer when organization membership is revoked during execution', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ role: 'member' }]).mockResolvedValueOnce([])
    await expect(execute()).rejects.toThrow('Organization not found')
    expect(mocks.lifecycle).toHaveBeenCalledOnce()
    expect(persistTurn).not.toHaveBeenCalled()
    expect(dbChainMockFns.update).toHaveBeenCalledOnce()
  })

  it('rechecks OAuth restrictions after the run', async () => {
    mocks.lifecycle.mockImplementationOnce(async () => {
      permissionGroupsResolveMockFns.mockGetUserPermissionConfigForOrganization.mockResolvedValue({
        ...DEFAULT_PERMISSION_GROUP_CONFIG,
        disableOAuthAppAccess: true,
      })
      return createResult()
    })
    await expect(execute()).rejects.toThrow('OAuth app access')
    expect(persistTurn).not.toHaveBeenCalled()
    expect(dbChainMockFns.update).toHaveBeenCalledOnce()
  })

  it('withholds the answer when Search is disabled during execution', async () => {
    knowledgeAvailabilityMockFns.mockRequireOrganizationSearchAvailable
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new OrchestrationError('forbidden', 'Search is not enabled'))
    await expect(execute()).rejects.toThrow('Search is not enabled')
    expect(persistTurn).not.toHaveBeenCalled()
    expect(dbChainMockFns.update).toHaveBeenCalledOnce()
  })

  it.each([
    { success: false, error: 'private backend diagnostic', content: 'partial answer' },
    { success: true, cancelled: true },
    { success: true, content: '' },
  ])('does not expose failed, cancelled, or empty answers', async (overrides) => {
    mocks.lifecycle.mockResolvedValue(createResult(overrides))
    await expect(execute()).rejects.toThrow(/assistant/i)
    expect(persistTurn).not.toHaveBeenCalled()
    expect(dbChainMockFns.update).toHaveBeenCalledOnce()
  })

  it('fails closed when retrieval makes provenance incomplete', async () => {
    const registry = new ResolvedSecretTraceRegistry()
    mocks.lifecycle.mockImplementation(async () => {
      registry.markIncomplete('untrusted-provenance')
      return createResult()
    })
    await expect(execute({ resultSecretRegistry: registry })).rejects.toThrow('safely')
    expect(persistTurn).not.toHaveBeenCalled()
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

  it('does not start or bill work for an already-cancelled request', async () => {
    await expect(execute({ signal: AbortSignal.abort() })).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(
      billingAttributionMockFns.mockResolveOrganizationBillingAttribution
    ).not.toHaveBeenCalled()
    expect(mocks.lifecycle).not.toHaveBeenCalled()
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
})
