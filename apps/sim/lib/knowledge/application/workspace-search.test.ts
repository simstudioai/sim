import {
  dbChainMockFns,
  hasMockCondition,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  afterSearch: vi.fn(async () => undefined),
  resolveWorkspace: vi.fn(),
  permission: vi.fn(),
  search: vi.fn(),
}))
vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (actual: string | null) => actual !== null,
  resolveEffectiveWorkspacePermission: mocks.permission,
}))
vi.mock('@/lib/knowledge/application/contexts', () => ({
  resolveKnowledgeWorkspaceContext: mocks.resolveWorkspace,
}))
vi.mock('@/lib/knowledge/application/search', () => ({
  runKnowledgeSearch: mocks.search,
  buildKnowledgeSearchContext: (
    _principal: unknown,
    context: unknown,
    knowledgeBases: unknown
  ) => ({
    ...(context as object),
    knowledgeBases,
    access: {},
  }),
  validateKnowledgeSearchInput: () => undefined,
  afterKnowledgeSearch: mocks.afterSearch,
}))

import { searchWorkspaceKnowledge } from '@/lib/knowledge/application/workspace-search'

const principal = { kind: 'session', userId: 'reader', sessionId: 'session' } as const
const input = { workspaceId: 'workspace', query: 'orion', topK: 20, filters: { source: 'slack' } }
describe('canonical workspace search', () => {
  beforeEach(() => {
    resetDbChainMock()
    mocks.resolveWorkspace.mockResolvedValue({
      workspaceId: 'workspace',
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'payer',
    })
    mocks.permission.mockResolvedValue('read')
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
    mocks.permission.mockResolvedValue(null)
    await expect(searchWorkspaceKnowledge.execute({ principal, input })).rejects.toThrow(
      'Insufficient workspace'
    )
    expect(dbChainMockFns.where).not.toHaveBeenCalled()
  })
})
