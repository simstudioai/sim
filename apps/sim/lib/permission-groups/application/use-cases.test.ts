import { recordAudit } from '@sim/audit'
import type { Principal } from '@sim/auth/principal'
import { member } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/audit', () => ({
  recordAudit: vi.fn(),
  AuditAction: {
    PERMISSION_GROUP_CREATED: 'permission_group.created',
    PERMISSION_GROUP_MEMBER_ADDED: 'permission_group.member_added',
  },
  AuditResourceType: { PERMISSION_GROUP: 'permission_group' },
}))

const mocks = vi.hoisted(() => ({
  regime: vi.fn(),
  config: vi.fn(),
  create: vi.fn(),
  bulkAdd: vi.fn(),
}))
vi.mock('@/lib/permission-groups/resolve.server', () => ({
  isOrganizationPermissionRegimeActive: mocks.regime,
  getUserPermissionConfigForOrganization: mocks.config,
}))
vi.mock('@/lib/permission-groups/group-manager', () => ({
  createPermissionGroupRecord: mocks.create,
  updatePermissionGroupRecord: vi.fn(),
  deletePermissionGroupRecord: vi.fn(),
  requirePermissionGroup: vi.fn(),
}))
vi.mock('@/lib/permission-groups/member-manager', () => ({
  bulkAddPermissionGroupMemberRecords: mocks.bulkAdd,
  addPermissionGroupMemberRecord: vi.fn(),
  removePermissionGroupMemberRecord: vi.fn(),
}))

import { SIM_CLI_CLIENT_ID } from '@/lib/auth/oauth-provider'
import { createPermissionGroup } from '@/lib/permission-groups/application/use-cases'
import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'

const session: Principal = { kind: 'session', userId: 'admin-1', sessionId: 'session-1' }
const key: Principal = { kind: 'personal_api_key', userId: 'admin-1', keyId: 'key-1' }
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
        principal: {
          kind: 'workspace_api_key',
          keyId: 'workspace-key',
          workspaceId: 'workspace-1',
        },
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
