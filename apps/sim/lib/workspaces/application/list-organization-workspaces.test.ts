import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { featureFlagsMock, featureFlagsMockFns } from '@sim/testing/mocks/feature-flags.mock'
import {
  organizationAuthorizationMock,
  organizationAuthorizationMockFns,
} from '@sim/testing/mocks/organization-authorization.mock'
import {
  permissionGroupScopeMock,
  permissionGroupScopeMockFns,
} from '@sim/testing/mocks/permission-group-scope.mock'
import {
  workspacesUtilsMock,
  workspacesUtilsMockFns,
} from '@sim/testing/mocks/workspaces-utils.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)
vi.mock('@/lib/core/application/organization-authorization', () => organizationAuthorizationMock)
vi.mock('@/lib/workspaces/utils', () => workspacesUtilsMock)
vi.mock('@/lib/permission-groups/config-scope.server', () => permissionGroupScopeMock)

import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'
import { listOrganizationWorkspaces } from '@/lib/workspaces/application/list-organization-workspaces'

const mocks = {
  feature: featureFlagsMockFns.mockIsFeatureEnabled,
  rows: workspacesUtilsMockFns.mockListAccessibleWorkspaceRowsForUser,
  authorize: organizationAuthorizationMockFns.mockAuthorizeOrganizationOperation,
  config: permissionGroupScopeMockFns.mockResolvePermissionGroupConfig,
}

const principal = createSessionPrincipal({ userId: 'user', sessionId: 'session' })
const row = (id: string, organizationId = 'org', role: 'read' | 'write' | 'admin' = 'read') => ({
  workspace: { id, name: `Workspace ${id}`, organizationId, allowPersonalApiKeys: true },
  permissionType: role,
})
beforeEach(() => {
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
