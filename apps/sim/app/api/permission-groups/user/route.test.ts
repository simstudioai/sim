/** @vitest-environment node */
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
}))
vi.mock('@/lib/permission-groups/resolve.server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/permission-groups/resolve.server')>()),
  resolveWorkspaceGroup: mocks.group,
}))

import { userPermissionConfigSchema } from '@/lib/api/contracts/permission-groups'
import { OrchestrationError } from '@/lib/core/orchestration/types'
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
  vi.clearAllMocks()
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

  it('authenticates before parsing or protected lookups', async () => {
    mocks.session.mockResolvedValue(null)
    expect((await get('')).status).toBe(401)
    expect(mocks.context).not.toHaveBeenCalled()
  })
  it.each(['', '?workspaceId='])('preserves missing workspace validation for %s', async (query) => {
    const response = await get(query)
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: 'workspaceId is required' })
    expect(mocks.context).not.toHaveBeenCalled()
  })
  it('preserves missing or archived workspace responses', async () => {
    mocks.context.mockRejectedValue(new OrchestrationError('not_found', 'Workspace not found'))
    const response = await get()
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ error: 'Workspace not found' })
    expect(mocks.group).not.toHaveBeenCalled()
  })
  it('refuses current nonmembers before loading their policy', async () => {
    mocks.role.mockResolvedValue(null)
    const response = await get()
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ error: 'Not a member of this workspace' })
    expect(mocks.admin).not.toHaveBeenCalled()
    expect(mocks.enterprise).not.toHaveBeenCalled()
    expect(mocks.group).not.toHaveBeenCalled()
  })
  it('leaves personal workspaces unrestricted without organization reads', async () => {
    mocks.context.mockResolvedValue({ ...context, workspaceOrganizationId: null })
    const response = await get()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ...unrestricted, organizationId: null })
    expect(mocks.admin).not.toHaveBeenCalled()
    expect(mocks.enterprise).not.toHaveBeenCalled()
    expect(mocks.group).not.toHaveBeenCalled()
  })
  it('retains organization admin status without enterprise entitlement', async () => {
    mocks.enterprise.mockResolvedValue(false)
    mocks.admin.mockResolvedValue(true)
    expect(await (await get()).json()).toEqual({ ...unrestricted, isOrgAdmin: true })
    expect(mocks.group).not.toHaveBeenCalled()
  })
  it('reads the acting member in the workspace owning organization and matches the server result', async () => {
    const group = {
      permissionGroupId: 'group',
      groupName: 'Restricted',
      config: { ...DEFAULT_PERMISSION_GROUP_CONFIG, hideCopilot: true },
    }
    mocks.group.mockResolvedValue(group)
    const response = await get()
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toEqual({ ...unrestricted, ...group, entitled: true })
    expect(mocks.group).toHaveBeenCalledWith('viewer', 'owning-org', 'workspace')
    expect(mocks.admin).toHaveBeenCalledWith('viewer', 'owning-org')
    const serverResult = await readUserPermissionConfig.execute({
      principal,
      input: { workspaceId: 'workspace' },
    })
    expect(userPermissionConfigSchema.parse(serverResult)).toEqual(body)
  })
  it('retains enterprise entitlement when no group applies', async () => {
    expect(await (await get()).json()).toEqual({ ...unrestricted, entitled: true })
  })
  it('does not turn policy infrastructure failures into unrestricted access', async () => {
    mocks.enterprise.mockImplementation(async (_organizationId, onError) => {
      if (onError === 'throw') throw new Error('unavailable')
      return false
    })
    expect((await get()).status).toBe(500)
    await expect(
      readUserPermissionConfig.execute({ principal, input: { workspaceId: 'workspace' } })
    ).rejects.toThrow('unavailable')
  })
  it('rejects API keys before canonical lookup on the shared server entry point', async () => {
    await expect(
      readUserPermissionConfig.execute({
        principal: { kind: 'personal_api_key', userId: 'viewer', keyId: 'key' },
        input: { workspaceId: 'workspace' },
      })
    ).rejects.toThrow('cannot perform operation')
    expect(mocks.context).not.toHaveBeenCalled()
  })
})
