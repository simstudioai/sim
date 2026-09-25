import { dbChainMockFns, drizzleOrmMock, resetDbChainMock, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetUsersWithPermissions } = vi.hoisted(() => ({
  mockGetUsersWithPermissions: vi.fn(),
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getUserEntityPermissions: vi.fn(),
  getUsersWithPermissions: mockGetUsersWithPermissions,
}))

import { listCredentialMembershipsForUser } from '@/lib/credentials/members'

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
