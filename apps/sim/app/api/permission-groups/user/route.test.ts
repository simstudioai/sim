import { createMockRequest, resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  context: vi.fn(),
  role: vi.fn(),
  admin: vi.fn(),
  enterprise: vi.fn(),
  group: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ getSession: mocks.session }))
vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  resolveActiveWorkspaceApplicationContext: mocks.context,
}))
vi.mock('@sim/platform-authz/workspace', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@sim/platform-authz/workspace')>()),
  resolveEffectiveWorkspacePermission: mocks.role,
}))
vi.mock('@/lib/workspaces/permissions/utils', () => ({ isOrganizationAdminOrOwner: mocks.admin }))
vi.mock('@/lib/billing/core/subscription', () => ({
  isOrganizationOnEnterprisePlan: mocks.enterprise,
  /** Permission resolution reads the governance axis; these tests drive both from one knob. */
  isOrganizationGovernanceActive: mocks.enterprise,
}))
vi.mock('@/lib/permission-groups/resolve.server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/permission-groups/resolve.server')>()),
  resolveWorkspaceGroup: mocks.group,
}))

import { readUserPermissionConfig } from '@/lib/permission-groups/application/read-user-config'
import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'
import { GET } from '@/app/api/permission-groups/user/route'

const principal = { kind: 'session', userId: 'viewer', sessionId: 'session' } as const
const context = {
  workspaceId: 'workspace',
  workspaceOrganizationId: 'owning-org',
  allowPersonalApiKeys: true,
  billedAccountUserId: 'owner',
}
const unrestricted = {
  permissionGroupId: null,
  groupName: null,
  config: null,
  entitled: false,
  organizationId: 'owning-org',
  isOrgAdmin: false,
}
function get(query = '?workspaceId=workspace') {
  return GET(
    createMockRequest('GET', undefined, {}, `http://localhost/api/permission-groups/user${query}`)
  )
}

beforeEach(() => {
  setEnvFlags({ isHosted: true, isAccessControlEnabled: true })
  mocks.session.mockResolvedValue({
    user: { id: 'viewer' },
    session: { id: 'session', activeOrganizationId: 'unrelated-org' },
  })
  mocks.context.mockResolvedValue(context)
  mocks.role.mockResolvedValue('read')
  mocks.admin.mockResolvedValue(false)
  mocks.enterprise.mockResolvedValue(true)
  mocks.group.mockResolvedValue(null)
})

afterEach(resetEnvFlagsMock)

describe('user permission policy shared read', () => {
  it.each([
    { hosted: false, accessControl: false, entitled: false },
    { hosted: false, accessControl: true, entitled: true },
    { hosted: true, accessControl: false, entitled: true },
  ])(
    'matches the active permission regime ($hosted, $accessControl)',
    async ({ hosted, accessControl, entitled }) => {
      setEnvFlags({
        isHosted: hosted,
        isAccessControlEnabled: accessControl,
        isBillingEnabled: false,
      })
      mocks.admin.mockResolvedValue(true)
      const group = {
        permissionGroupId: 'group',
        groupName: 'Restricted',
        config: { ...DEFAULT_PERMISSION_GROUP_CONFIG, hideCopilot: true },
      }
      mocks.group.mockResolvedValue(group)
      const expected = { ...unrestricted, ...(entitled ? group : {}), entitled, isOrgAdmin: true }
      expect(await (await get()).json()).toEqual(expected)
      expect(
        await readUserPermissionConfig.execute({ principal, input: { workspaceId: 'workspace' } })
      ).toEqual(expected)
      if (!entitled) {
        expect(mocks.group).not.toHaveBeenCalled()
        expect(mocks.enterprise).not.toHaveBeenCalled()
      }
    }
  )
  it('refuses current nonmembers before loading their policy', async () => {
    mocks.role.mockResolvedValue(null)
    const response = await get()
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ error: 'Not a member of this workspace' })
    expect(mocks.admin).not.toHaveBeenCalled()
    expect(mocks.enterprise).not.toHaveBeenCalled()
    expect(mocks.group).not.toHaveBeenCalled()
  })
  it('does not turn policy infrastructure failures into unrestricted access', async () => {
    /**
     * The governance reader has no lenient mode — answering `false` on a failed read would mean
     * "no permission group", which denies nothing — so a failure here is simply a rejection.
     */
    mocks.enterprise.mockRejectedValue(new Error('unavailable'))
    expect((await get()).status).toBe(500)
    await expect(
      readUserPermissionConfig.execute({ principal, input: { workspaceId: 'workspace' } })
    ).rejects.toThrow('unavailable')
  })
  it('rejects actorless workspace keys before canonical lookup on the shared server entry point', async () => {
    await expect(
      readUserPermissionConfig.execute({
        principal: { kind: 'workspace_api_key', workspaceId: 'workspace', keyId: 'key' },
        input: { workspaceId: 'workspace' },
      })
    ).rejects.toMatchObject({ detailCode: 'WORKSPACE_KEY_OPERATION_NOT_PERMITTED' })
    expect(mocks.context).not.toHaveBeenCalled()
  })
})
