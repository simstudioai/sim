import { member } from '@sim/db/schema'
import { queueTableRows, resetDbChainMock } from '@sim/testing'
import {
  createPersonalApiKeyPrincipal,
  createSessionPrincipal,
} from '@sim/testing/factories/principal.factory'
import {
  knowledgeAvailabilityMock,
  knowledgeAvailabilityMockFns,
} from '@sim/testing/mocks/knowledge-availability.mock'
import {
  knowledgeContextsMock,
  knowledgeContextsMockFns,
} from '@sim/testing/mocks/knowledge-contexts.mock'
import {
  permissionGroupsResolveMock,
  permissionGroupsResolveMockFns,
} from '@sim/testing/mocks/permission-groups-resolve.mock'
import { workspaceAuthzMock } from '@sim/testing/mocks/workspace-authz.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
}))
vi.mock('@/lib/knowledge/application/contexts', () => knowledgeContextsMock)
vi.mock('@/lib/permission-groups/resolve.server', () => permissionGroupsResolveMock)
vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
vi.mock('@/lib/knowledge/access/availability', () => knowledgeAvailabilityMock)
vi.mock('@/lib/knowledge/search/activity-stats', () => ({
  loadOrganizationSearchStats: mocks.load,
}))

import { readOrganizationSearchStats } from '@/lib/knowledge/application/organization-search-stats'

const principal = createSessionPrincipal({ userId: 'admin', sessionId: 'session' })
const input = { organizationId: 'organization', period: '7d', surface: 'mcp' } as const

beforeEach(() => {
  resetDbChainMock()
  knowledgeContextsMockFns.mockResolveKnowledgeOwnerContext.mockResolvedValue({
    organizationId: 'organization',
  })
  permissionGroupsResolveMockFns.mockGetUserPermissionConfigForOrganization.mockResolvedValue(null)
  knowledgeAvailabilityMockFns.mockRequireOrganizationSearchAvailable.mockResolvedValue(undefined)
  mocks.load.mockResolvedValue({ totals: { invocations: 3 } })
})

describe('organization Search stats authorization', () => {
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
        principal: createPersonalApiKeyPrincipal({ userId: 'admin', keyId: 'key' }),
        input,
      })
    ).rejects.toThrow()
    expect(knowledgeContextsMockFns.mockResolveKnowledgeOwnerContext).not.toHaveBeenCalled()
    expect(mocks.load).not.toHaveBeenCalled()
  })
  it('fails closed when Search is disabled', async () => {
    queueTableRows(member, [{ role: 'admin' }])
    knowledgeAvailabilityMockFns.mockRequireOrganizationSearchAvailable.mockRejectedValueOnce(
      new Error('Search is disabled')
    )
    await expect(readOrganizationSearchStats.execute({ principal, input })).rejects.toThrow(
      'Search is disabled'
    )
    expect(mocks.load).not.toHaveBeenCalled()
  })
})
