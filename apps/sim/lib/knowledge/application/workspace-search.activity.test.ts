import { member } from '@sim/db/schema'
import { queueTableRows, resetDbChainMock } from '@sim/testing'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import {
  knowledgeAvailabilityMock,
  knowledgeAvailabilityMockFns,
} from '@sim/testing/mocks/knowledge-availability.mock'
import {
  knowledgeContextsMock,
  knowledgeContextsMockFns,
} from '@sim/testing/mocks/knowledge-contexts.mock'
import {
  knowledgeSearchUseCaseMock,
  knowledgeSearchUseCaseMockFns,
} from '@sim/testing/mocks/knowledge-search-use-case.mock'
import {
  permissionGroupsResolveMock,
  permissionGroupsResolveMockFns,
} from '@sim/testing/mocks/permission-groups-resolve.mock'
import { workspaceAuthzMock } from '@sim/testing/mocks/workspace-authz.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  findIndex: vi.fn(),
  activity: vi.fn(),
}))
vi.mock('@/lib/knowledge/application/contexts', () => knowledgeContextsMock)
vi.mock('@/lib/permission-groups/resolve.server', () => permissionGroupsResolveMock)
vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
vi.mock('@/lib/knowledge/search/search-index', () => ({
  findSearchIndex: hoisted.findIndex,
  findWorkspaceSearchIndex: hoisted.findIndex,
}))
vi.mock('@/lib/knowledge/access/availability', () => knowledgeAvailabilityMock)
vi.mock('@/lib/knowledge/search/activity', () => ({
  recordOrganizationSearchActivity: hoisted.activity,
}))
vi.mock('@/lib/knowledge/application/search', () => knowledgeSearchUseCaseMock)

import {
  searchOrganizationKnowledge,
  searchScopedKnowledge,
} from '@/lib/knowledge/application/workspace-search'

const mocks = {
  ...hoisted,
  afterSearch: knowledgeSearchUseCaseMockFns.mockAfterKnowledgeSearch,
  search: knowledgeSearchUseCaseMockFns.mockRunKnowledgeSearch,
}
mocks.afterSearch.mockImplementation(async () => undefined)

knowledgeContextsMockFns.mockResolveKnowledgeOwnerContext.mockImplementation((...args: unknown[]) =>
  knowledgeContextsMockFns.mockResolveKnowledgeOrganizationContext(...args)
)
knowledgeContextsMockFns.mockResolveKnowledgeWorkspaceContext.mockImplementation(
  (...args: unknown[]) => knowledgeContextsMockFns.mockResolveKnowledgeOrganizationContext(...args)
)

const principal = createSessionPrincipal({ userId: 'reader', sessionId: 'session' })
const input = { organizationId: 'org', query: 'policy', topK: 20, surface: 'slack' } as const

beforeEach(() => {
  resetDbChainMock()
  knowledgeContextsMockFns.mockResolveKnowledgeOrganizationContext.mockResolvedValue({
    organizationId: 'org',
  })
  permissionGroupsResolveMockFns.mockGetUserPermissionConfigForOrganization.mockResolvedValue(null)
  mocks.findIndex.mockResolvedValue(null)
  knowledgeAvailabilityMockFns.mockRequireOrganizationSearchAvailable.mockResolvedValue(undefined)
  mocks.activity.mockResolvedValue(undefined)
  mocks.search.mockResolvedValue({
    results: [],
    knowledgeBases: [{ id: 'index' }],
    knowledgeBaseId: 'index',
  })
})

describe.each([
  { name: 'organization Assistant', operation: searchOrganizationKnowledge },
  { name: 'scoped Search', operation: searchScopedKnowledge },
])('$name activity before an index exists', ({ operation }) => {
  it('records an authorized empty invocation for the acting member', async () => {
    queueTableRows(member, [{ role: 'member' }])
    expect(await operation.execute({ principal, input })).toEqual({
      results: [],
      retrieval: { status: 'complete', timedOutLegs: [] },
      query: 'policy',
      knowledgeBases: [],
    })
    expect(
      knowledgeAvailabilityMockFns.mockRequireOrganizationSearchAvailable
    ).toHaveBeenCalledExactlyOnceWith('org')
    expect(mocks.activity).toHaveBeenCalledExactlyOnceWith({
      organizationId: 'org',
      userId: 'reader',
      surface: 'slack',
      results: [],
    })
    expect(mocks.search).not.toHaveBeenCalled()
  })

  it('does not meter an unavailable Search request', async () => {
    queueTableRows(member, [{ role: 'member' }])
    knowledgeAvailabilityMockFns.mockRequireOrganizationSearchAvailable.mockRejectedValueOnce(
      new Error('Search is disabled')
    )
    await expect(operation.execute({ principal, input })).rejects.toThrow('Search is disabled')
    expect(mocks.activity).not.toHaveBeenCalled()
    expect(mocks.search).not.toHaveBeenCalled()
  })

  it('does not discover the index or meter a nonmember request', async () => {
    queueTableRows(member, [])
    await expect(operation.execute({ principal, input })).rejects.toMatchObject({
      code: 'not_found',
    })
    expect(mocks.findIndex).not.toHaveBeenCalled()
    expect(mocks.activity).not.toHaveBeenCalled()
  })

  it('does not meter a request that was already cancelled', async () => {
    queueTableRows(member, [{ role: 'member' }])
    const controller = new AbortController()
    controller.abort(new Error('Search cancelled'))
    await expect(
      operation.execute({ principal, input: { ...input, signal: controller.signal } })
    ).rejects.toThrow('Search cancelled')
    expect(mocks.activity).not.toHaveBeenCalled()
    expect(mocks.search).not.toHaveBeenCalled()
  })
})
