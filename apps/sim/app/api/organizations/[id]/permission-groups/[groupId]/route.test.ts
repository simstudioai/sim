/**
 * @vitest-environment node
 */
import { db } from '@sim/db'
import { permissionGroup } from '@sim/db/schema'
import {
  authMockFns,
  createMockRequest,
  dbChainMockFns,
  queueTableRows,
  resetDbChainMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UpdatePermissionGroupBody } from '@/lib/api/contracts/permission-groups'

const mocks = vi.hoisted(() => ({
  acquireLock: vi.fn(),
  authorize: vi.fn(),
  loadGroup: vi.fn(),
}))

vi.mock('@/lib/permission-groups/locks', () => ({
  acquirePermissionGroupOrgLock: mocks.acquireLock,
}))

vi.mock('@/lib/permission-groups/application/group-membership', () => ({
  findAllMembersWorkspaceConflict: vi.fn(),
  findScopeConflicts: vi.fn(),
}))

vi.mock('@/app/api/organizations/[id]/permission-groups/utils', () => ({
  authorizeOrgAccessControl: mocks.authorize,
  loadGroupInOrganization: mocks.loadGroup,
  findWorkspacesNotInOrganization: vi.fn(),
  formatAllMembersConflictError: vi.fn(),
  formatScopeConflictError: vi.fn(),
  getGroupWorkspaces: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  recordAudit: vi.fn(),
  AuditAction: { PERMISSION_GROUP_UPDATED: 'permission_group.updated' },
  AuditResourceType: { PERMISSION_GROUP: 'permission_group' },
}))

import { PUT } from '@/app/api/organizations/[id]/permission-groups/[groupId]/route'

const ORGANIZATION_ID = 'org-1'
const GROUP_ID = 'group-1'
const GROUP = {
  id: GROUP_ID,
  organizationId: ORGANIZATION_ID,
  name: 'Default',
  description: null,
  isDefault: true,
  config: { disableOAuthAppAccess: false },
}

async function updateUnderLock(body: UpdatePermissionGroupBody) {
  const lockEntered = Promise.withResolvers<boolean>()
  const lockReleased = Promise.withResolvers<void>()
  mocks.acquireLock.mockImplementationOnce(() => {
    lockEntered.resolve(true)
    return lockReleased.promise
  })

  const pendingResponse = PUT(createMockRequest('PUT', body), {
    params: Promise.resolve({ id: ORGANIZATION_ID, groupId: GROUP_ID }),
  })
  try {
    expect(await Promise.race([lockEntered.promise, pendingResponse.then(() => false)])).toBe(true)
    expect(mocks.acquireLock).toHaveBeenCalledExactlyOnceWith(db, ORGANIZATION_ID)
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  } finally {
    lockReleased.resolve()
  }

  const response = await pendingResponse
  expect(response.status).toBe(200)
  expect(dbChainMockFns.update).toHaveBeenCalledExactlyOnceWith(permissionGroup)
  expect(mocks.loadGroup).toHaveBeenLastCalledWith(GROUP_ID, ORGANIZATION_ID, db)
  return response
}

describe('permission group PUT policy serialization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'admin-1' } })
    mocks.authorize.mockResolvedValue(null)
    mocks.loadGroup.mockResolvedValue(GROUP)
  })

  it('locks a config-only update and writes the requested OAuth restriction', async () => {
    queueTableRows(permissionGroup, [{ ...GROUP, config: { disableOAuthAppAccess: true } }])

    await updateUnderLock({ config: { disableOAuthAppAccess: true } })

    expect(dbChainMockFns.set).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ config: expect.objectContaining({ disableOAuthAppAccess: true }) })
    )
  })

  it.each([{ name: 'Renamed group' }, { description: 'Updated description' }])(
    'locks metadata-only update %j without restoring stale policy',
    async (metadata) => {
      if ('name' in metadata) queueTableRows(permissionGroup, [])
      queueTableRows(permissionGroup, [
        { ...GROUP, ...metadata, config: { disableOAuthAppAccess: true } },
      ])

      const response = await updateUnderLock(metadata)

      expect(dbChainMockFns.set).toHaveBeenCalledExactlyOnceWith(expect.objectContaining(metadata))
      expect(dbChainMockFns.set.mock.calls[0][0]).not.toHaveProperty('config')
      await expect(response.json()).resolves.toMatchObject({
        permissionGroup: { config: { disableOAuthAppAccess: true } },
      })
    }
  )

  it('merges a config patch with the policy reloaded under the lock', async () => {
    mocks.loadGroup
      .mockResolvedValueOnce(GROUP)
      .mockResolvedValueOnce({ ...GROUP, config: { disableOAuthAppAccess: true } })
    queueTableRows(permissionGroup, [
      { ...GROUP, config: { disableOAuthAppAccess: true, disableCliAccess: true } },
    ])

    await updateUnderLock({ config: { disableCliAccess: true } })

    expect(dbChainMockFns.set).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        config: expect.objectContaining({ disableOAuthAppAccess: true, disableCliAccess: true }),
      })
    )
  })

  it('does not write when the group disappears before the locked reload', async () => {
    mocks.loadGroup.mockResolvedValueOnce(GROUP).mockResolvedValueOnce(null)
    mocks.acquireLock.mockResolvedValueOnce(undefined)

    const response = await PUT(createMockRequest('PUT', { description: 'Updated description' }), {
      params: Promise.resolve({ id: ORGANIZATION_ID, groupId: GROUP_ID }),
    })

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Permission group not found' })
    expect(mocks.acquireLock).toHaveBeenCalledExactlyOnceWith(db, ORGANIZATION_ID)
    expect(mocks.loadGroup).toHaveBeenLastCalledWith(GROUP_ID, ORGANIZATION_ID, db)
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })
})
