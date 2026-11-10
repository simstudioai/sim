import { member } from '@sim/db/schema'
import { queueTableRows, resetDbChainMock } from '@sim/testing'
import { createPersonalApiKeyPrincipal } from '@sim/testing/factories/principal.factory'
import { createRouteContext } from '@sim/testing/helpers/http'
import { credentialGroupsServiceMock } from '@sim/testing/mocks/credential-groups-service.mock'
import {
  knowledgeAvailabilityMock,
  knowledgeAvailabilityMockFns,
} from '@sim/testing/mocks/knowledge-availability.mock'
import { knowledgeBaseUseCasesMock } from '@sim/testing/mocks/knowledge-base-use-cases.mock'
import { knowledgeContextsMock } from '@sim/testing/mocks/knowledge-contexts.mock'
import { knowledgeEmbeddingsMock } from '@sim/testing/mocks/knowledge-embeddings.mock'
import { knowledgeServiceMock } from '@sim/testing/mocks/knowledge-service.mock'
import {
  permissionGroupsResolveMock,
  permissionGroupsResolveMockFns,
} from '@sim/testing/mocks/permission-groups-resolve.mock'
import { rateLimiterMock } from '@sim/testing/mocks/rate-limiter.mock'
import { createMockRequest } from '@sim/testing/mocks/request.mock'
import { simSearchConnectorsMock } from '@sim/testing/mocks/sim-search-connectors.mock'
import { urlsMockFns } from '@sim/testing/mocks/urls.mock'
import { v2ApiKeyAuthModuleMock, v2RouteMocks } from '@sim/testing/mocks/v2-route.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ index: vi.fn(), liveSearch: vi.fn() }))
vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => rateLimiterMock)
vi.mock('@/lib/core/utils/after-response', () => ({ afterResponse: vi.fn() }))
vi.mock('@/lib/knowledge/mcp/activity', () => ({ recordOrganizationSearchMcpActivity: vi.fn() }))
vi.mock('@/lib/knowledge/application/contexts', () => knowledgeContextsMock)
vi.mock('@/lib/knowledge/application/billing', () => ({
  resolveKnowledgeAttributedUserId: (principal: { userId: string }) => principal.userId,
}))
vi.mock('@/lib/knowledge/search/search-index', () => ({ findSearchIndex: mocks.index }))
vi.mock('@/lib/permission-groups/resolve.server', () => permissionGroupsResolveMock)
vi.mock('@/lib/credential-groups/service', () => credentialGroupsServiceMock)
vi.mock('@/lib/knowledge/service', () => knowledgeServiceMock)
vi.mock('@/lib/knowledge/embeddings', () => knowledgeEmbeddingsMock)
vi.mock('@/lib/knowledge/application/knowledge-bases', () => knowledgeBaseUseCasesMock)
vi.mock('@/lib/knowledge/application/connectors', () => ({
  createKnowledgeConnector: { execute: vi.fn() },
}))
vi.mock('@/lib/knowledge/application/connector-access', () => ({
  startKnowledgeConnectorMemberEnrollment: { execute: vi.fn() },
}))
vi.mock('@/lib/knowledge/access/availability', () => knowledgeAvailabilityMock)
vi.mock('@/connectors/registry', () => ({ CONNECTOR_META_REGISTRY: {} }))
vi.mock('@/lib/sim-search/connectors', () => simSearchConnectorsMock)
vi.mock('@/lib/sim-search/live/application', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/sim-search/live/application')>()),
  searchLiveKnowledge: { execute: mocks.liveSearch },
}))

import { createKnowledgeMcpHandlers } from '@/lib/knowledge/mcp/route-handler'

urlsMockFns.mockGetBaseUrl.mockReturnValue('http://localhost')

const handlers = createKnowledgeMcpHandlers()
const principal = createPersonalApiKeyPrincipal({ userId: 'person-1' })

/** Calls a tool over the real route, SDK transport, and Search MCP server. */
async function callTool(name: string, args: Record<string, unknown>) {
  const response = await handlers.POST(
    createMockRequest({
      method: 'POST',
      url: 'http://localhost/api/mcp/search/organizations/org-1',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'x-forwarded-for': '127.0.0.1',
        'x-api-key': 'personal-key',
      },
      body: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name, arguments: args },
      },
    }),
    createRouteContext({ organizationId: 'org-1' })
  )
  return { status: response.status, body: await response.json() }
}

function callSearch(args: Record<string, unknown>) {
  return callTool('search', args)
}

function searchedInput() {
  const call = mocks.liveSearch.mock.lastCall?.[0]
  if (!call) throw new Error('Expected the search use case to run')
  return call.input
}

beforeEach(() => {
  resetDbChainMock()
  v2RouteMocks.authenticate.mockResolvedValue({
    principal,
    keyType: 'personal',
    keyExpiresAt: null,
    rateLimitSubjectIds: ['person-1'],
    rateLimitSubscription: null,
  })
  permissionGroupsResolveMockFns.mockGetUserPermissionConfigForOrganization.mockResolvedValue(null)
  knowledgeAvailabilityMockFns.mockRequireOrganizationSearchAvailable.mockResolvedValue(undefined)
  mocks.index.mockResolvedValue({ id: 'index-1' })
  mocks.liveSearch.mockResolvedValue({
    results: [],
    retrieval: { status: 'complete', timedOutLegs: [] },
    live: { backend: 'live', accounts: [], guidance: '' },
  })
  queueTableRows(member, [{ role: 'member' }])
})

describe('Search MCP tool arguments with one possible reading', () => {
  it('searches without native queries when the client sends an empty nativeQueries list', async () => {
    const { body } = await callSearch({ query: 'release notes', nativeQueries: [] })
    expect(body.result?.isError).not.toBe(true)
    expect(searchedInput().nativeQueries).toBeUndefined()
  })

  it('treats a null optional native query field as omitted', async () => {
    const { body } = await callSearch({
      query: 'release',
      nativeQueries: [{ provider: 'jira', query: 'text ~ "release"', kind: null }],
    })
    expect(body.result?.isError).not.toBe(true)
    expect(searchedInput().nativeQueries).toEqual([{ provider: 'jira', query: 'text ~ "release"' }])
  })

  it('applies filters every native query carries alike as the search filters', async () => {
    const { body } = await callSearch({
      query: 'release',
      nativeQueries: [
        {
          provider: 'gmail',
          query: 'subject:release',
          startDate: '2026-10-01T00:00:00-07:00',
          sortBy: 'newest',
        },
        {
          provider: 'slack',
          query: 'release',
          startDate: '2026-10-01T00:00:00-07:00',
          sortBy: 'newest',
        },
      ],
    })
    expect(body.result?.isError).not.toBe(true)
    const input = searchedInput()
    expect(input.filters).toMatchObject({
      startDate: '2026-10-01T00:00:00-07:00',
      sortBy: 'newest',
    })
    expect(input.nativeQueries).toEqual([
      { provider: 'gmail', query: 'subject:release' },
      { provider: 'slack', query: 'release' },
    ])
  })

  it('reads a top-level provider as the source filter', async () => {
    const { body } = await callSearch({ query: 'standup', provider: 'google_calendar' })
    expect(body.result?.isError).not.toBe(true)
    expect(searchedInput().filters).toMatchObject({ source: 'google_calendar' })
  })

  it.each([
    ['carry different values', '2026-09-01T00:00:00Z'],
    ['do not all carry it', undefined],
  ])('still rejects native queries whose dates %s, rather than choosing one', async (_, other) => {
    const { body } = await callSearch({
      query: 'release',
      nativeQueries: [
        { provider: 'gmail', query: 'release', startDate: '2026-10-01T00:00:00Z' },
        { provider: 'slack', query: 'release', ...(other ? { startDate: other } : {}) },
      ],
    })
    expect(JSON.stringify(body)).toContain('startDate')
    expect(mocks.liveSearch).not.toHaveBeenCalled()
  })

  it('still rejects a top-level provider that names no provider', async () => {
    const { body } = await callSearch({ query: 'standup', provider: 'Google Calendar' })
    expect(JSON.stringify(body)).toContain('provider')
    expect(mocks.liveSearch).not.toHaveBeenCalled()
  })

  it.each(['constructor', 'toString', '__proto__'])(
    'answers a call to the unknown tool %s with an MCP error, not a server error',
    async (name) => {
      const { status, body } = await callTool(name, {})
      expect(status).toBe(200)
      expect(JSON.stringify(body)).toContain(name)
    }
  )
})
