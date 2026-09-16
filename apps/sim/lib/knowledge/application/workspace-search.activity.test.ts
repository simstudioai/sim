/** @vitest-environment node */
import { member } from '@sim/db/schema'
import { queueTableRows, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  policy: vi.fn(),
  findIndex: vi.fn(),
  available: vi.fn(),
  activity: vi.fn(),
  search: vi.fn(),
}))
vi.mock('@/lib/knowledge/application/contexts', () => ({
  resolveKnowledgeOrganizationContext: mocks.context,
  resolveKnowledgeOwnerContext: mocks.context,
  resolveKnowledgeWorkspaceContext: mocks.context,
}))
vi.mock('@/lib/permission-groups/resolve.server', () => ({
  getUserPermissionConfigForOrganization: mocks.policy,
}))
vi.mock('@sim/platform-authz/workspace', () => ({
  isOrgAdminRole: (role: string) => role === 'admin' || role === 'owner',
}))
vi.mock('@/lib/knowledge/search/search-index', () => ({
  findSearchIndex: mocks.findIndex,
  findWorkspaceSearchIndex: mocks.findIndex,
}))
vi.mock('@/lib/knowledge/access/availability', () => ({
  requireOrganizationSearchAvailable: mocks.available,
}))
vi.mock('@/lib/knowledge/search/activity', () => ({
  recordOrganizationSearchActivity: mocks.activity,
}))
vi.mock('@/lib/knowledge/application/search', () => ({
  searchKnowledge: { execute: mocks.search },
}))

import {
  searchOrganizationKnowledge,
  searchScopedKnowledge,
} from '@/lib/knowledge/application/workspace-search'

const principal = { kind: 'session', userId: 'reader', sessionId: 'session' } as const
const input = { organizationId: 'org', query: 'policy', topK: 20, surface: 'slack' } as const

beforeEach(() => {
  vi.clearAllMocks()
  resetDbChainMock()
  mocks.context.mockResolvedValue({ organizationId: 'org' })
  mocks.policy.mockResolvedValue(null)
  mocks.findIndex.mockResolvedValue(null)
  mocks.available.mockResolvedValue(undefined)
  mocks.activity.mockResolvedValue(undefined)
  mocks.search.mockResolvedValue({ results: [], knowledgeBases: [{ id: 'index' }] })
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
    expect(mocks.available).toHaveBeenCalledExactlyOnceWith('org')
    expect(mocks.activity).toHaveBeenCalledExactlyOnceWith({
      organizationId: 'org',
      userId: 'reader',
      surface: 'slack',
      results: [],
    })
    expect(mocks.search).not.toHaveBeenCalled()
  })

  it('leaves indexed invocation metering to the canonical search operation', async () => {
    queueTableRows(member, [{ role: 'member' }])
    mocks.findIndex.mockResolvedValueOnce({ id: 'index' })
    await operation.execute({ principal, input })
    expect(mocks.search).toHaveBeenCalledOnce()
    expect(mocks.search).toHaveBeenCalledWith({
      principal,
      input: expect.objectContaining({ knowledgeBaseIds: ['index'], surface: 'slack' }),
    })
    expect(mocks.activity).not.toHaveBeenCalled()
  })

  it('does not meter an unavailable Search request', async () => {
    queueTableRows(member, [{ role: 'member' }])
    mocks.available.mockRejectedValueOnce(new Error('Search is disabled'))
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

  it.each(['index', 'availability'] as const)(
    'does not meter a request cancelled during the %s lookup',
    async (lookup) => {
      queueTableRows(member, [{ role: 'member' }])
      const controller = new AbortController()
      const cancel = () => controller.abort(new Error('Search cancelled'))
      if (lookup === 'index') {
        mocks.findIndex.mockImplementationOnce(async () => {
          cancel()
          return null
        })
      } else {
        mocks.available.mockImplementationOnce(async () => {
          cancel()
        })
      }

      await expect(
        operation.execute({ principal, input: { ...input, signal: controller.signal } })
      ).rejects.toThrow('Search cancelled')
      expect(mocks.findIndex).toHaveBeenCalledOnce()
      expect(mocks.activity).not.toHaveBeenCalled()
      expect(mocks.search).not.toHaveBeenCalled()
    }
  )
})
