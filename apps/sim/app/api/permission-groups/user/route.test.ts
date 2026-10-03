import { createMockRequest, resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import {
  createSessionPrincipal,
  createWorkspaceApiKeyPrincipal,
} from '@sim/testing/factories/principal.factory'
import { authMockFns } from '@sim/testing/mocks/auth.mock'
import {
  billingSubscriptionMock,
  billingSubscriptionMockFns,
} from '@sim/testing/mocks/billing-subscription.mock'
import { permissionsMock, permissionsMockFns } from '@sim/testing/mocks/permissions.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import {
  workspaceContextMock,
  workspaceContextMockFns,
} from '@sim/testing/mocks/workspace-context.mock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  group: vi.fn(),
}))
vi.mock('@/lib/workspaces/application/workspace-context', () => workspaceContextMock)
vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
vi.mock('@/lib/billing/core/subscription', () => billingSubscriptionMock)
vi.mock('@/lib/permission-groups/resolve.server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/permission-groups/resolve.server')>()),
  resolveWorkspaceGroup: mocks.group,
}))

import { readUserPermissionConfig } from '@/lib/permission-groups/application/read-user-config'
import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'
import { GET } from '@/app/api/permission-groups/user/route'

const mockGetSession = authMockFns.mockGetSession
const mockResolveContext = workspaceContextMockFns.mockResolveActiveWorkspaceApplicationContext
const mockResolveRole = workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission
const mockIsOrgAdmin = permissionsMockFns.mockIsOrganizationAdminOrOwner
const mockIsEnterprise = billingSubscriptionMockFns.mockIsOrganizationOnEnterprisePlan
/** Permission resolution reads the governance axis; these tests drive both from one knob. */
billingSubscriptionMockFns.mockIsOrganizationGovernanceActive.mockImplementation(
  (...args: unknown[]) => mockIsEnterprise(...args)
)

const principal = createSessionPrincipal({ userId: 'viewer', sessionId: 'session' })
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
  mockGetSession.mockResolvedValue({
    user: { id: 'viewer' },
    session: { id: 'session', activeOrganizationId: 'unrelated-org' },
  })
  mockResolveContext.mockResolvedValue(context)
  mockResolveRole.mockResolvedValue('read')
  mockIsOrgAdmin.mockResolvedValue(false)
  mockIsEnterprise.mockResolvedValue(true)
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
      mockIsOrgAdmin.mockResolvedValue(true)
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
        expect(mockIsEnterprise).not.toHaveBeenCalled()
      }
    }
  )
  it('refuses current nonmembers before loading their policy', async () => {
    mockResolveRole.mockResolvedValue(null)
    const response = await get()
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ error: 'Not a member of this workspace' })
    expect(mockIsOrgAdmin).not.toHaveBeenCalled()
    expect(mockIsEnterprise).not.toHaveBeenCalled()
    expect(mocks.group).not.toHaveBeenCalled()
  })
  it('does not turn policy infrastructure failures into unrestricted access', async () => {
    /**
     * The governance reader has no lenient mode — answering `false` on a failed read would mean
     * "no permission group", which denies nothing — so a failure here is simply a rejection.
     */
    mockIsEnterprise.mockRejectedValue(new Error('unavailable'))
    expect((await get()).status).toBe(500)
    await expect(
      readUserPermissionConfig.execute({ principal, input: { workspaceId: 'workspace' } })
    ).rejects.toThrow('unavailable')
  })
  it('rejects actorless workspace keys before canonical lookup on the shared server entry point', async () => {
    await expect(
      readUserPermissionConfig.execute({
        principal: createWorkspaceApiKeyPrincipal({ workspaceId: 'workspace', keyId: 'key' }),
        input: { workspaceId: 'workspace' },
      })
    ).rejects.toMatchObject({ detailCode: 'WORKSPACE_KEY_OPERATION_NOT_PERMITTED' })
    expect(mockResolveContext).not.toHaveBeenCalled()
  })
})
