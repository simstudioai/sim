import type { Principal } from '@sim/auth/principal'
import { scimConnection } from '@sim/db/schema'
import { queueTableRows, resetDbChainMock } from '@sim/testing'
import {
  organizationMembershipMock,
  organizationMembershipMockFns,
} from '@sim/testing/mocks/organization-membership.mock'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const hoistedMocks = vi.hoisted(() => ({
  findGroup: vi.fn(),
  filterUsers: vi.fn(),
  memberIds: vi.fn(),
  members: vi.fn(),
  addMember: vi.fn(),
  removeMember: vi.fn(),
  countMembers: vi.fn(),
  touch: vi.fn(),
  update: vi.fn(),
  reconcile: vi.fn(),
}))

vi.mock('@/lib/billing/organizations/membership', () => organizationMembershipMock)
vi.mock('@/ee/scim/lib/projection/reconcile-user', () => ({
  reconcileUsersProjection: hoistedMocks.reconcile,
}))
vi.mock('@/ee/scim/lib/projection/auto-map', () => ({
  autoMapPermissionGroupByName: vi.fn(),
  settleMappedPermissionGroupsExplicit: vi.fn(),
}))
vi.mock('@/ee/scim/lib/repository/groups', () => ({
  findScimGroupById: hoistedMocks.findGroup,
  filterOwnedUsers: hoistedMocks.filterUsers,
  loadGroupMemberIds: hoistedMocks.memberIds,
  loadGroupMembers: hoistedMocks.members,
  addGroupMember: hoistedMocks.addMember,
  removeGroupMember: hoistedMocks.removeMember,
  countGroupMembers: hoistedMocks.countMembers,
  touchScimGroup: hoistedMocks.touch,
  updateScimGroup: hoistedMocks.update,
  deleteScimGroupRow: vi.fn(),
  insertScimGroup: vi.fn(),
  loadGroupMembersForGroups: vi.fn(),
  pageScimGroups: vi.fn(),
}))
vi.mock('@/ee/scim/lib/application/audit', () => ({ recordScimAuditEntries: vi.fn() }))
vi.mock('@/ee/scim/lib/base-url', () => ({ scimBaseUrl: () => 'https://sim.test/api/scim/v2' }))

import { replaceScimGroup } from '@/ee/scim/lib/application/groups/manage-groups'
import { toGroupResource } from '@/ee/scim/lib/protocol/resources'

const mocks = {
  ...hoistedMocks,
  locks: organizationMembershipMockFns.mockAcquireOrganizationMutationLock,
}

const principal: Principal = {
  kind: 'scim_connection',
  connectionId: 'conn-1',
  organizationId: 'org-1',
  credentialId: 'cred-1',
  scopes: ['groups:write'],
}
const initialGroup = {
  id: 'group-1',
  externalId: null,
  displayName: 'Engineering',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
}

afterAll(resetDbChainMock)

describe('replaceScimGroup', () => {
  beforeEach(() => {
    resetDbChainMock()
    queueTableRows(scimConnection, [
      { id: 'conn-1', organizationId: 'org-1', status: 'active', settings: {} },
    ])
    let group = { ...initialGroup }
    const memberIds = new Set(['user-1'])
    mocks.findGroup.mockImplementation(async () => group)
    mocks.filterUsers.mockImplementation(async (_tx, _connectionId, ids: string[]) => ids)
    mocks.memberIds.mockImplementation(async () => [...memberIds])
    mocks.members.mockImplementation(async () =>
      [...memberIds].map((scimUserId) => ({ scimUserId, displayName: scimUserId }))
    )
    mocks.addMember.mockImplementation(async (_tx, { scimUserId }: { scimUserId: string }) => {
      const added = !memberIds.has(scimUserId)
      memberIds.add(scimUserId)
      return added
    })
    mocks.removeMember.mockImplementation(async (_tx, { scimUserId }: { scimUserId: string }) =>
      memberIds.delete(scimUserId)
    )
    mocks.countMembers.mockImplementation(async () => memberIds.size)
    mocks.touch.mockImplementation(async () => {
      group = { ...group, updatedAt: new Date('2026-01-02T00:00:00.000Z') }
    })
  })

  it('advances resource metadata and version for a membership-only replacement', async () => {
    const previous = toGroupResource(initialGroup, 'https://sim.test/api/scim/v2')
    const result = await replaceScimGroup.execute({
      principal,
      input: { groupId: 'group-1', group: { displayName: 'Engineering', memberIds: ['user-2'] } },
    })
    expect(result.resource.members?.map((entry) => entry.value)).toEqual(['user-2'])
    expect(result.resource.meta.lastModified).toBe('2026-01-02T00:00:00.000Z')
    expect(result.resource.meta.version).not.toBe(previous.meta.version)
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.reconcile).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ scimUserIds: ['user-1', 'user-2'] })
    )
  })
})
