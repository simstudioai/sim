import {
  dbChainMockFns,
  hasMockCondition,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import {
  knowledgeContextsMock,
  knowledgeContextsMockFns,
} from '@sim/testing/mocks/knowledge-contexts.mock'
import {
  knowledgeSearchUseCaseMock,
  knowledgeSearchUseCaseMockFns,
} from '@sim/testing/mocks/knowledge-search-use-case.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
vi.mock('@/lib/knowledge/application/contexts', () => knowledgeContextsMock)
vi.mock('@/lib/knowledge/application/search', () => knowledgeSearchUseCaseMock)

import { searchWorkspaceKnowledge } from '@/lib/knowledge/application/workspace-search'

const mocks = {
  afterSearch: knowledgeSearchUseCaseMockFns.mockAfterKnowledgeSearch,
  search: knowledgeSearchUseCaseMockFns.mockRunKnowledgeSearch,
}
mocks.afterSearch.mockImplementation(async () => undefined)

workspaceAuthzMockFns.mockPermissionSatisfies.mockImplementation(
  (actual: string | null) => actual !== null
)

const principal = createSessionPrincipal({ userId: 'reader', sessionId: 'session' })
const input = { workspaceId: 'workspace', query: 'orion', topK: 20, filters: { source: 'slack' } }
describe('canonical workspace search', () => {
  beforeEach(() => {
    resetDbChainMock()
    knowledgeContextsMockFns.mockResolveKnowledgeWorkspaceContext.mockResolvedValue({
      workspaceId: 'workspace',
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'payer',
    })
    workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue('read')
    mocks.search.mockResolvedValue({
      results: [],
      knowledgeBases: [{ id: 'index', name: 'Enterprise Search' }],
    })
  })
  it('authorizes the person before selecting the canonical active index and passes the same principal and filters', async () => {
    queueTableRows(schemaMock.knowledgeBase, [{ id: 'index' }])
    await searchWorkspaceKnowledge.execute({ principal, input })
    /** The search runs under the context this use case resolved; the index is its one base. */
    expect(mocks.search).toHaveBeenCalledWith(
      expect.objectContaining({
        principal,
        input: { ...input, knowledgeBaseIds: ['index'] },
        context: expect.objectContaining({
          workspaceId: 'workspace',
          knowledgeBases: [expect.objectContaining({ id: 'index' })],
        }),
      })
    )
    expect(
      hasMockCondition(
        dbChainMockFns.where.mock.calls[0][0],
        (node) =>
          node.type === 'eq' &&
          node.left === schemaMock.knowledgeBase.isSearchIndex &&
          node.right === true
      )
    ).toBe(true)
    expect(dbChainMockFns.limit).toHaveBeenCalledWith(1)
  })
  it('refuses a nonmember before querying the protected index', async () => {
    workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue(null)
    await expect(searchWorkspaceKnowledge.execute({ principal, input })).rejects.toThrow(
      'Insufficient workspace'
    )
    expect(dbChainMockFns.where).not.toHaveBeenCalled()
  })
})
