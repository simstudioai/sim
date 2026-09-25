import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  rows: vi.fn(),
  config: vi.fn(),
  feature: vi.fn(),
}))
vi.mock('@/lib/core/config/feature-flags', () => ({ isFeatureEnabled: mocks.feature }))
vi.mock('@/lib/core/application/organization-authorization', () => ({
  authorizeOrganizationOperation: mocks.authorize,
}))
vi.mock('@/lib/workspaces/utils', () => ({ listAccessibleWorkspaceRowsForUser: mocks.rows }))
vi.mock('@/lib/permission-groups/config-scope.server', () => ({
  resolvePermissionGroupConfig: mocks.config,
}))

import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'
import { listOrganizationWorkspaces } from '@/lib/workspaces/application/list-organization-workspaces'

const principal = { kind: 'session' as const, userId: 'user', sessionId: 'session' }
const row = (id: string, organizationId = 'org', role: 'read' | 'write' | 'admin' = 'read') => ({
  workspace: { id, name: `Workspace ${id}`, organizationId, allowPersonalApiKeys: true },
  permissionType: role,
})
beforeEach(() => {
  vi.resetAllMocks()
  mocks.authorize.mockResolvedValue({ userId: 'user', organizationId: 'org' })
  mocks.config.mockResolvedValue(DEFAULT_PERMISSION_GROUP_CONFIG)
  mocks.feature.mockResolvedValue(false)
  mocks.rows.mockResolvedValue([row('b', 'org', 'write'), row('a'), row('outside', 'other')])
})
describe('organization workspace inventory', () => {
  it('exact filtering cannot expose a foreign organization and rechecks membership on every request', async () => {
    expect(
      (
        await listOrganizationWorkspaces.execute({
          principal,
          input: { organizationId: 'org', workspaceId: 'outside', limit: 1 },
        })
      ).workspaces
    ).toEqual([])
    expect(mocks.feature).not.toHaveBeenCalled()
    mocks.authorize.mockRejectedValue(new Error('Membership revoked'))
    await expect(
      listOrganizationWorkspaces.execute({ principal, input: { organizationId: 'org', limit: 1 } })
    ).rejects.toThrow('Membership revoked')
    expect(mocks.rows).toHaveBeenCalledTimes(1)
  })
  it('reports workspace personal-key disablement even when permission-group config allows it', async () => {
    mocks.rows.mockResolvedValue([
      { ...row('a'), workspace: { ...row('a').workspace, allowPersonalApiKeys: false } },
    ])
    expect(
      (
        await listOrganizationWorkspaces.execute({
          principal,
          input: { organizationId: 'org', limit: 1 },
        })
      ).workspaces[0]
    ).toMatchObject({
      capabilityDetail: 'restrictions',
      deniedCapabilities: ['personal_api_key.use'],
    })
  })
})

it('does not disclose rollout detail for a denied operation', async () => {
  mocks.config.mockResolvedValue({
    ...DEFAULT_PERMISSION_GROUP_CONFIG,
    deniedTools: ['table_query_rows_v2'],
  })
  const result = await listOrganizationWorkspaces.execute({
    principal,
    input: { organizationId: 'org', workspaceId: 'a', limit: 1 },
  })
  expect(result.workspaces[0]).toMatchObject({ operationAvailability: {} })
  expect(mocks.feature).not.toHaveBeenCalled()
})
