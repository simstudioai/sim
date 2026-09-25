import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  role: vi.fn(),
  config: vi.fn(),
  regime: vi.fn(),
  group: vi.fn(),
  admin: vi.fn(),
}))
vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  resolveActiveWorkspaceApplicationContext: mocks.context,
}))
vi.mock('@sim/platform-authz/workspace', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@sim/platform-authz/workspace')>()),
  resolveEffectiveWorkspacePermission: mocks.role,
}))
vi.mock('@/lib/permission-groups/config-scope.server', () => ({
  resolvePermissionGroupConfig: mocks.config,
}))
vi.mock('@/lib/permission-groups/resolve.server', () => ({
  isOrganizationPermissionRegimeActive: mocks.regime,
  resolveWorkspaceGroup: mocks.group,
}))
vi.mock('@/lib/workspaces/permissions/utils', () => ({ isOrganizationAdminOrOwner: mocks.admin }))

import { SIM_CLI_CLIENT_ID } from '@/lib/auth/oauth-provider'
import { readUserPermissionConfig } from '@/lib/permission-groups/application/read-user-config'
import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'

const personal = { kind: 'personal_api_key', userId: 'caller', keyId: 'key' } as const
const oauth = {
  kind: 'oauth_access_token',
  userId: 'caller',
  clientId: 'client',
  tokenId: 'token',
  scopes: ['api:read'],
  expiresAt: new Date('2099-01-01'),
} as const
const context = {
  workspaceId: 'workspace',
  workspaceOrganizationId: 'organization',
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner',
}
const input = { workspaceId: 'workspace' }

beforeEach(() => {
  mocks.context.mockResolvedValue(context)
  mocks.role.mockResolvedValue('read')
  mocks.config.mockResolvedValue(null)
  mocks.regime.mockResolvedValue(true)
  mocks.admin.mockResolvedValue(false)
  mocks.group.mockResolvedValue({
    permissionGroupId: 'group',
    groupName: 'Readers',
    config: DEFAULT_PERMISSION_GROUP_CONFIG,
  })
})

describe('effective caller permission configuration', () => {
  it('rejects workspace keys before canonical loading', async () => {
    await expect(
      readUserPermissionConfig.execute({
        principal: { kind: 'workspace_api_key', workspaceId: 'workspace', keyId: 'key' },
        input,
      })
    ).rejects.toMatchObject({ detailCode: 'WORKSPACE_KEY_OPERATION_NOT_PERMITTED' })
    expect(mocks.context).not.toHaveBeenCalled()
    expect(mocks.group).not.toHaveBeenCalled()
  })

  it('does not disclose a group to a caller without workspace access', async () => {
    mocks.role.mockResolvedValue(null)
    await expect(readUserPermissionConfig.execute({ principal: personal, input })).rejects.toThrow()
    expect(mocks.regime).not.toHaveBeenCalled()
    expect(mocks.group).not.toHaveBeenCalled()
  })

  it.each([
    [personal, { disablePersonalApiKeys: true }],
    [oauth, { disableOAuthAppAccess: true }],
    [{ ...oauth, clientId: SIM_CLI_CLIENT_ID }, { disableCliAccess: true }],
  ] as const)(
    'retains credential-wide restrictions even for a capability-exempt read',
    async (principal, restriction) => {
      mocks.config.mockResolvedValue({ ...DEFAULT_PERMISSION_GROUP_CONFIG, ...restriction })
      await expect(readUserPermissionConfig.execute({ principal, input })).rejects.toThrow()
      expect(mocks.group).not.toHaveBeenCalled()
    }
  )

  it('enforces the workspace personal-key switch', async () => {
    mocks.context.mockResolvedValue({ ...context, allowPersonalApiKeys: false })
    await expect(
      readUserPermissionConfig.execute({ principal: personal, input })
    ).rejects.toMatchObject({ detailCode: 'PERSONAL_API_KEYS_DISABLED' })
    expect(mocks.group).not.toHaveBeenCalled()
  })

  it.each([
    { ...oauth, scopes: ['search:read'] },
    { ...oauth, expiresAt: new Date('2000-01-01') },
  ])('rejects invalid OAuth authority before loading the workspace', async (principal) => {
    await expect(readUserPermissionConfig.execute({ principal, input })).rejects.toThrow()
    expect(mocks.context).not.toHaveBeenCalled()
  })
})
