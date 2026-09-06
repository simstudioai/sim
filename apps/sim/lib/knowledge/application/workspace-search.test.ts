/** @vitest-environment node */
import {
  dbChainMockFns,
  hasMockCondition,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
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
  searchKnowledge: { execute: mocks.search },
}))

import { searchWorkspaceKnowledge } from '@/lib/knowledge/application/workspace-search'

const principal = { kind: 'session', userId: 'reader', sessionId: 'session' } as const
const input = { workspaceId: 'workspace', query: 'orion', topK: 20, filters: { source: 'slack' } }
describe('canonical workspace search', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
    expect(mocks.search).toHaveBeenCalledWith({
      principal,
      input: { ...input, knowledgeBaseIds: ['index'] },
    })
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
  it('does not search ordinary KBs when there is no index', async () => {
    queueTableRows(schemaMock.knowledgeBase, [])
    await expect(searchWorkspaceKnowledge.execute({ principal, input })).resolves.toMatchObject({
      results: [],
      knowledgeBases: [],
    })
    expect(mocks.search).not.toHaveBeenCalled()
  })
  it('refuses a nonmember before querying the protected index', async () => {
    mocks.permission.mockResolvedValue(null)
    await expect(searchWorkspaceKnowledge.execute({ principal, input })).rejects.toThrow(
      'Insufficient workspace'
    )
    expect(dbChainMockFns.where).not.toHaveBeenCalled()
  })
})
