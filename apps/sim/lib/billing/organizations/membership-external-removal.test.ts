import { member } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import {
  organizationMemberLimitsMock,
  organizationMemberLimitsMockFns,
} from '@sim/testing/mocks/organization-member-limits.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/billing/organizations/member-limits', () => organizationMemberLimitsMock)

import {
  removeExternalUserFromOrganizationWorkspaces,
  removeUserFromOrganization,
} from '@/lib/billing/organizations/membership'

const mockSetOrgMemberUsageLimit = organizationMemberLimitsMockFns.mockSetOrgMemberUsageLimit

describe('external organization access removal', () => {
  beforeEach(() => {
    resetDbChainMock()
  })

  it('clears a stale per-user organization usage cap in the removal transaction', async () => {
    await removeExternalUserFromOrganizationWorkspaces({
      organizationId: 'org-1',
      userId: 'external-user',
    })

    expect(dbChainMockFns.transaction).toHaveBeenCalledTimes(1)
    expect(mockSetOrgMemberUsageLimit).toHaveBeenCalledWith(
      'org-1',
      'external-user',
      null,
      undefined,
      expect.anything()
    )
  })

  it('rejects an actor demoted before the locked removal', async () => {
    queueTableRows(member, [{ id: 'membership', userId: 'target', role: 'member' }])
    queueTableRows(member, [{ id: 'actor-membership', role: 'member' }])
    await expect(
      removeUserFromOrganization({
        organizationId: 'org-1',
        userId: 'target',
        memberId: 'membership',
        actorUserId: 'actor',
        onError: 'throw',
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
  })

  it('reports membership appearing during external removal as a conflict', async () => {
    queueTableRows(member, [])
    queueTableRows(member, [{ id: 'new-membership' }])
    await expect(
      removeExternalUserFromOrganizationWorkspaces({ organizationId: 'org-1', userId: 'external' })
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
  })
})
