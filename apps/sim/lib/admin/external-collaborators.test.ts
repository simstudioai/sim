/**
 * @vitest-environment node
 */
import { member, permissions } from '@sim/db/schema'
import { queueTableRows, resetDbChainMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  setLimit: vi.fn(),
  acquireLock: vi.fn(),
  recordAudit: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: { ORGANIZATION_UPDATED: 'organization.updated' },
  AuditResourceType: { ORGANIZATION: 'organization' },
  recordAudit: mocks.recordAudit,
}))

vi.mock('@/lib/billing/organizations/member-limits', () => ({
  setOrgMemberUsageLimit: mocks.setLimit,
}))
vi.mock('@/lib/billing/organizations/membership', () => ({
  acquireOrganizationMutationLock: mocks.acquireLock,
}))

import { updateDashboardExternalCollaboratorUsageLimit } from '@/lib/admin/external-collaborators'

const actor = { id: 'admin-1', name: 'Admin', email: 'admin@sim.ai' }

afterAll(resetDbChainMock)

describe('updateDashboardExternalCollaboratorUsageLimit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
  })

  it('clears an existing cap', async () => {
    queueTableRows(member, [])
    queueTableRows(permissions, [{ userId: 'external-1' }])

    await updateDashboardExternalCollaboratorUsageLimit('org-1', 'external-1', null, actor)

    expect(mocks.setLimit).toHaveBeenCalledWith(
      'org-1',
      'external-1',
      null,
      'admin-1',
      expect.anything()
    )
  })

  it('rejects internal organization members', async () => {
    queueTableRows(member, [{ id: 'member-1' }])

    await expect(
      updateDashboardExternalCollaboratorUsageLimit('org-1', 'user-1', 100, actor)
    ).rejects.toThrow('internal organization member')
    expect(mocks.setLimit).not.toHaveBeenCalled()
    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })

  it('rejects users without a current non-archived workspace permission', async () => {
    queueTableRows(member, [])
    queueTableRows(permissions, [])

    await expect(
      updateDashboardExternalCollaboratorUsageLimit('org-1', 'user-1', 100, actor)
    ).rejects.toThrow('not a current external collaborator')
    expect(mocks.setLimit).not.toHaveBeenCalled()
  })
})
