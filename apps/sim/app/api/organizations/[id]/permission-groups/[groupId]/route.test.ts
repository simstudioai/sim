import { db } from '@sim/db'
import { permissionGroup } from '@sim/db/schema'
import { authMockFns, createMockRequest, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { createRouteContext } from '@sim/testing/helpers/http'
import { auditMock } from '@sim/testing/mocks/audit.mock'
import {
  organizationAuthorizationMock,
  organizationAuthorizationMockFns,
} from '@sim/testing/mocks/organization-authorization.mock'
import {
  permissionGroupLocksMock,
  permissionGroupLocksMockFns,
} from '@sim/testing/mocks/permission-group-locks.mock'
import {
  permissionGroupsResolveMock,
  permissionGroupsResolveMockFns,
} from '@sim/testing/mocks/permission-groups-resolve.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UpdatePermissionGroupBody } from '@/lib/api/contracts/permission-groups'

const mocks = vi.hoisted(() => ({
  loadGroup: vi.fn(),
}))

vi.mock('@/lib/permission-groups/locks', () => permissionGroupLocksMock)

vi.mock('@/lib/permission-groups/application/group-membership', () => ({
  findAllMembersWorkspaceConflict: vi.fn(),
  findScopeConflicts: vi.fn(),
}))

vi.mock('@/lib/permission-groups/repository', () => ({
  loadGroupInOrganization: mocks.loadGroup,
  findWorkspacesNotInOrganization: vi.fn(),
  getGroupWorkspaces: vi.fn(),
}))

vi.mock('@sim/audit', () => auditMock)

vi.mock('@/lib/core/application/organization-authorization', () => organizationAuthorizationMock)
vi.mock('@/lib/permission-groups/resolve.server', () => permissionGroupsResolveMock)

import { PUT } from '@/app/api/organizations/[id]/permission-groups/[groupId]/route'

const { mockAcquirePermissionGroupOrgLock } = permissionGroupLocksMockFns

const mockAuthorize = organizationAuthorizationMockFns.mockAuthorizeOrganizationOperation
permissionGroupsResolveMockFns.mockIsOrganizationPermissionRegimeActive.mockResolvedValue(true)

const ORGANIZATION_ID = 'org-1'
const GROUP_ID = 'group-1'
const GROUP = {
  id: GROUP_ID,
  organizationId: ORGANIZATION_ID,
  name: 'Default',
  description: null,
  isDefault: true,
  config: { disableOAuthAppAccess: false },
  membershipMode: 'inherit',
  createdBy: 'admin-1',
  createdAt: new Date(),
  updatedAt: new Date(),
}

async function updateUnderLock(body: UpdatePermissionGroupBody) {
  const lockEntered = Promise.withResolvers<boolean>()
  const lockReleased = Promise.withResolvers<void>()
  mockAcquirePermissionGroupOrgLock.mockImplementationOnce(() => {
    lockEntered.resolve(true)
    return lockReleased.promise
  })

  const pendingResponse = PUT(
    createMockRequest('PUT', body),
    createRouteContext({ id: ORGANIZATION_ID, groupId: GROUP_ID })
  )
  try {
    expect(await Promise.race([lockEntered.promise, pendingResponse.then(() => false)])).toBe(true)
    expect(mockAcquirePermissionGroupOrgLock).toHaveBeenCalledExactlyOnceWith(db, ORGANIZATION_ID, {
      lockTimeoutAlreadyBounded: true,
    })
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
    resetDbChainMock()
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: 'admin-1' },
      session: { id: 'session-1' },
    })
    mockAuthorize.mockResolvedValue({
      userId: 'admin-1',
      organizationId: ORGANIZATION_ID,
      role: 'admin',
    })
    mocks.loadGroup.mockResolvedValue(GROUP)
  })

  it('merges a config patch with the policy reloaded under the lock', async () => {
    mocks.loadGroup.mockResolvedValueOnce({ ...GROUP, config: { disableOAuthAppAccess: true } })
    dbChainMockFns.returning.mockResolvedValueOnce([
      { ...GROUP, config: { disableOAuthAppAccess: true, disableCliAccess: true } },
    ])

    await updateUnderLock({ config: { disableCliAccess: true } })

    expect(dbChainMockFns.set).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        config: expect.objectContaining({ disableOAuthAppAccess: true, disableCliAccess: true }),
      })
    )
  })

  it('does not write when the group disappears before the locked read', async () => {
    mocks.loadGroup.mockResolvedValueOnce(null)
    mockAcquirePermissionGroupOrgLock.mockResolvedValueOnce(undefined)

    const response = await PUT(
      createMockRequest('PUT', { description: 'Updated description' }),
      createRouteContext({ id: ORGANIZATION_ID, groupId: GROUP_ID })
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({ error: 'Permission group not found' })
    expect(mockAcquirePermissionGroupOrgLock).toHaveBeenCalledExactlyOnceWith(db, ORGANIZATION_ID, {
      lockTimeoutAlreadyBounded: true,
    })
    expect(mocks.loadGroup).toHaveBeenLastCalledWith(GROUP_ID, ORGANIZATION_ID, db)
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })
})
