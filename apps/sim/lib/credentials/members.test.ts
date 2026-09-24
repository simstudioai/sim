/**
 * @vitest-environment node
 */
import { dbChainMockFns, drizzleOrmMock, resetDbChainMock, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetUsersWithPermissions } = vi.hoisted(() => ({
  mockGetUsersWithPermissions: vi.fn(),
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getUserEntityPermissions: vi.fn(),
  getUsersWithPermissions: mockGetUsersWithPermissions,
}))

import { listCredentialMembers, listCredentialMembershipsForUser } from '@/lib/credentials/members'
import type { CredentialRow } from '@/lib/credentials/queries'

describe('listCredentialMembershipsForUser', () => {
  beforeEach(() => {
    resetDbChainMock()
  })

  it('excludes managed credentials from ordinary memberships', async () => {
    dbChainMockFns.where.mockResolvedValue([])

    await listCredentialMembershipsForUser('user-1')

    expect(drizzleOrmMock.notInArray).toHaveBeenCalledWith(schemaMock.credential.type, [
      'managed_oauth',
      'managed_mcp',
    ])
  })
})

describe('listCredentialMembers', () => {
  beforeEach(() => {
    resetDbChainMock()
  })

  it('carries each member’s profile image, explicit and derived alike', async () => {
    dbChainMockFns.where.mockResolvedValueOnce([
      {
        id: 'cm-1',
        userId: 'user-1',
        role: 'member',
        status: 'active',
        joinedAt: null,
        userName: 'Ada',
        userEmail: 'ada@example.com',
        userImage: 'ada.png',
      },
    ])
    mockGetUsersWithPermissions.mockResolvedValueOnce([
      {
        userId: 'user-2',
        name: 'Sam',
        email: 'sam@example.com',
        image: 'sam.png',
        permissionType: 'admin',
      },
    ])

    const members = await listCredentialMembers({
      id: 'cred-1',
      workspaceId: 'ws-1',
      type: 'oauth',
    } as CredentialRow)

    expect(members.map((member) => [member.userId, member.userImage])).toEqual([
      ['user-1', 'ada.png'],
      ['user-2', 'sam.png'],
    ])
  })
})
