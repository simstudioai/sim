/** @vitest-environment node */
import { member } from '@sim/db/schema'
import { queueTableRows, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  policy: vi.fn(),
  available: vi.fn(),
  load: vi.fn(),
}))
vi.mock('@/lib/knowledge/application/contexts', () => ({
  resolveKnowledgeOwnerContext: mocks.context,
}))
vi.mock('@/lib/permission-groups/resolve.server', () => ({
  getUserPermissionConfigForOrganization: mocks.policy,
}))
vi.mock('@sim/platform-authz/workspace', () => ({
  isOrgAdminRole: (role: string) => role === 'admin' || role === 'owner',
}))
vi.mock('@/lib/knowledge/access/availability', () => ({
  requireOrganizationSearchAvailable: mocks.available,
}))
vi.mock('@/lib/knowledge/search/activity-stats', () => ({
  loadOrganizationSearchStats: mocks.load,
}))

import { readOrganizationSearchStats } from '@/lib/knowledge/application/organization-search-stats'

const principal = { kind: 'session', userId: 'admin', sessionId: 'session' } as const
const input = { organizationId: 'organization', period: '7d', surface: 'mcp' } as const

beforeEach(() => {
  vi.clearAllMocks()
  resetDbChainMock()
  mocks.context.mockResolvedValue({ organizationId: 'organization' })
  mocks.policy.mockResolvedValue(null)
  mocks.available.mockResolvedValue(undefined)
  mocks.load.mockResolvedValue({ totals: { invocations: 3 } })
})

describe('organization Search stats authorization', () => {
  it.each(['admin', 'owner'])(
    'allows a current %s and forwards the selected scope',
    async (role) => {
      queueTableRows(member, [{ role }])
      expect(await readOrganizationSearchStats.execute({ principal, input })).toEqual({
        totals: { invocations: 3 },
      })
      expect(mocks.available).toHaveBeenCalledWith('organization')
      expect(mocks.load).toHaveBeenCalledWith(input)
    }
  )
  it.each([
    { rows: [{ role: 'member' }], code: 'forbidden' },
    { rows: [], code: 'not_found' },
  ])('rejects unauthorized access with $code before aggregation', async ({ rows, code }) => {
    queueTableRows(member, rows)
    await expect(readOrganizationSearchStats.execute({ principal, input })).rejects.toMatchObject({
      code,
    })
    expect(mocks.load).not.toHaveBeenCalled()
  })
  it('rejects API keys before protected loading', async () => {
    await expect(
      readOrganizationSearchStats.execute({
        principal: { kind: 'personal_api_key', userId: 'admin', keyId: 'key' },
        input,
      })
    ).rejects.toThrow()
    expect(mocks.context).not.toHaveBeenCalled()
    expect(mocks.load).not.toHaveBeenCalled()
  })
  it('fails closed when Search is disabled', async () => {
    queueTableRows(member, [{ role: 'admin' }])
    mocks.available.mockRejectedValueOnce(new Error('Search is disabled'))
    await expect(readOrganizationSearchStats.execute({ principal, input })).rejects.toThrow(
      'Search is disabled'
    )
    expect(mocks.load).not.toHaveBeenCalled()
  })
})
