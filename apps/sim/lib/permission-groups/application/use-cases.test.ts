import type { Principal } from '@sim/auth/principal'
import { member } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import {
  createPersonalApiKeyPrincipal,
  createSessionPrincipal,
  createWorkspaceApiKeyPrincipal,
} from '@sim/testing/factories/principal.factory'
import { auditMock, auditMockFns } from '@sim/testing/mocks/audit.mock'
import {
  permissionGroupsResolveMock,
  permissionGroupsResolveMockFns,
} from '@sim/testing/mocks/permission-groups-resolve.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/audit', () => auditMock)

const hoisted = vi.hoisted(() => ({
  create: vi.fn(),
  bulkAdd: vi.fn(),
}))
vi.mock('@/lib/permission-groups/resolve.server', () => permissionGroupsResolveMock)
vi.mock('@/lib/permission-groups/group-manager', () => ({
  createPermissionGroupRecord: hoisted.create,
  updatePermissionGroupRecord: vi.fn(),
  deletePermissionGroupRecord: vi.fn(),
  requirePermissionGroup: vi.fn(),
}))
vi.mock('@/lib/permission-groups/member-manager', () => ({
  bulkAddPermissionGroupMemberRecords: hoisted.bulkAdd,
  addPermissionGroupMemberRecord: vi.fn(),
  removePermissionGroupMemberRecord: vi.fn(),
}))

import { SIM_CLI_CLIENT_ID } from '@/lib/auth/oauth-provider'
import { createPermissionGroup } from '@/lib/permission-groups/application/use-cases'
import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'

const recordAudit = auditMockFns.mockRecordAudit
const mocks = {
  ...hoisted,
  regime: permissionGroupsResolveMockFns.mockIsOrganizationPermissionRegimeActive,
  config: permissionGroupsResolveMockFns.mockGetUserPermissionConfigForOrganization,
}

const session: Principal = createSessionPrincipal({ userId: 'admin-1' })
const key: Principal = createPersonalApiKeyPrincipal({ userId: 'admin-1' })
const oauth: Principal = {
  kind: 'oauth_access_token',
  userId: 'admin-1',
  clientId: 'client-1',
  tokenId: 'token-1',
  scopes: ['api:read', 'api:write'],
  expiresAt: new Date('2099-01-01'),
}
const input = {
  organizationId: 'org-1',
  changes: { name: 'Restricted', workspaceIds: ['workspace-1'] },
}
const group = { id: 'group-1', name: 'Restricted', isDefault: false, workspaceIds: ['workspace-1'] }

beforeEach(() => {
  resetDbChainMock()
  mocks.regime.mockResolvedValue(true)
  mocks.config.mockResolvedValue(null)
  mocks.create.mockResolvedValue(group)
})

describe('permission-group organization authorization', () => {
  it('rejects workspace keys before protected loading', async () => {
    await expect(
      createPermissionGroup.execute({
        principal: createWorkspaceApiKeyPrincipal({ keyId: 'workspace-key' }),
        input,
      })
    ).rejects.toMatchObject({ detailCode: 'PRINCIPAL_KIND_NOT_PERMITTED' })
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
    expect(mocks.regime).not.toHaveBeenCalled()
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('conceals organizations with no current membership', async () => {
    queueTableRows(member, [])
    await expect(createPermissionGroup.execute({ principal: key, input })).rejects.toMatchObject({
      code: 'not_found',
      message: 'Organization not found',
    })
    expect(mocks.regime).not.toHaveBeenCalled()
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('requires an organization admin before checking entitlement', async () => {
    queueTableRows(member, [{ role: 'member' }])
    await expect(createPermissionGroup.execute({ principal: key, input })).rejects.toMatchObject({
      detailCode: 'ORGANIZATION_ADMIN_REQUIRED',
      message: 'Admin permissions required',
    })
    expect(mocks.regime).not.toHaveBeenCalled()
  })

  it('requires the active permission regime after organization authorization', async () => {
    queueTableRows(member, [{ role: 'admin' }])
    mocks.regime.mockResolvedValue(false)
    await expect(
      createPermissionGroup.execute({ principal: session, input })
    ).rejects.toMatchObject({
      detailCode: 'ENTERPRISE_PLAN_REQUIRED',
      message: 'Access Control is an Enterprise feature',
    })
    expect(mocks.create).not.toHaveBeenCalled()
    expect(recordAudit).not.toHaveBeenCalled()
  })

  it.each([
    [key, { disablePersonalApiKeys: true }],
    [oauth, { disableOAuthAppAccess: true }],
    [{ ...oauth, clientId: SIM_CLI_CLIENT_ID }, { disableCliAccess: true }],
  ] as const)('rechecks credential restrictions', async (principal, restrictions) => {
    queueTableRows(member, [{ role: 'admin' }])
    mocks.config.mockResolvedValue({ ...DEFAULT_PERMISSION_GROUP_CONFIG, ...restrictions })
    await expect(createPermissionGroup.execute({ principal, input })).rejects.toThrow()
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('requires write scope before loading organization membership', async () => {
    await expect(
      createPermissionGroup.execute({ principal: { ...oauth, scopes: ['api:read'] }, input })
    ).rejects.toThrow()
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
  })

  it('does not translate infrastructure failures into access denials', async () => {
    dbChainMockFns.select.mockImplementationOnce(() => {
      throw new Error('database unavailable')
    })
    await expect(createPermissionGroup.execute({ principal: session, input })).rejects.toThrow(
      'database unavailable'
    )
    expect(recordAudit).not.toHaveBeenCalled()
  })
})
