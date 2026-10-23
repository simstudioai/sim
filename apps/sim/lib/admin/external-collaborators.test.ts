import { member, permissions } from '@sim/db/schema'
import {
  dbChainMockFns,
  flattenMockConditions,
  queueTableRows,
  resetDbChainMock,
} from '@sim/testing'
import { auditMock, auditMockFns } from '@sim/testing/mocks/audit.mock'
import {
  organizationMemberLimitsMock,
  organizationMemberLimitsMockFns,
} from '@sim/testing/mocks/organization-member-limits.mock'
import {
  organizationMembershipMock,
  organizationMembershipMockFns,
} from '@sim/testing/mocks/organization-membership.mock'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/audit', () => auditMock)

vi.mock('@/lib/billing/organizations/member-limits', () => organizationMemberLimitsMock)
vi.mock('@/lib/billing/organizations/membership', () => organizationMembershipMock)

import { updateDashboardExternalCollaboratorUsageLimit } from '@/lib/admin/external-collaborators'

const mocks = {
  setLimit: organizationMemberLimitsMockFns.mockSetOrgMemberUsageLimit,
  acquireLock: organizationMembershipMockFns.mockAcquireOrganizationMutationLock,
  recordAudit: auditMockFns.mockRecordAudit,
}

const actor = { id: 'admin-1', name: 'Admin', email: 'admin@sim.ai' }

afterAll(resetDbChainMock)

describe('updateDashboardExternalCollaboratorUsageLimit', () => {
  beforeEach(() => {
    resetDbChainMock()
  })

  it('sets a cap through the canonical organization usage-limit service', async () => {
    queueTableRows(member, [])
    queueTableRows(permissions, [{ userId: 'external-1' }])

    await updateDashboardExternalCollaboratorUsageLimit('org-1', 'external-1', 30, actor)

    expect(mocks.acquireLock).toHaveBeenCalledWith(expect.anything(), 'org-1')
    expect(mocks.setLimit).toHaveBeenCalledWith(
      'org-1',
      'external-1',
      30,
      'admin-1',
      expect.anything()
    )
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'admin-1',
        resourceId: 'org-1',
        metadata: { targetUserId: 'external-1', usageLimitDollars: 30 },
      })
    )
    const collaboratorPredicate = dbChainMockFns.where.mock.calls[1]?.[0]
    expect(
      flattenMockConditions(collaboratorPredicate).some((condition) => condition.type === 'isNull')
    ).toBe(false)
  })

  it('rejects internal organization members', async () => {
    queueTableRows(member, [{ id: 'member-1' }])

    await expect(
      updateDashboardExternalCollaboratorUsageLimit('org-1', 'user-1', 100, actor)
    ).rejects.toThrow('internal organization member')
    expect(mocks.setLimit).not.toHaveBeenCalled()
    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })

  it('rejects users without any organization workspace permission', async () => {
    queueTableRows(member, [])
    queueTableRows(permissions, [])

    await expect(
      updateDashboardExternalCollaboratorUsageLimit('org-1', 'user-1', 100, actor)
    ).rejects.toThrow('not a current external collaborator')
    expect(mocks.setLimit).not.toHaveBeenCalled()
  })
})
