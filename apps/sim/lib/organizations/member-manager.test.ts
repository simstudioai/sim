/** @vitest-environment node */
import { member, user } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  locks: vi.fn(),
  scim: vi.fn(),
  remove: vi.fn(),
  external: vi.fn(),
  seats: vi.fn(),
}))
vi.mock('@/lib/billing/organizations/membership', () => ({
  acquireOrganizationUserMutationLocks: mocks.locks,
  removeUserFromOrganization: mocks.remove,
  removeExternalUserFromOrganizationWorkspaces: mocks.external,
  WORKSPACE_BILLING_ACCOUNT_REMOVAL_ERROR: 'Billing owner cannot be removed',
}))
vi.mock('@/lib/billing/organizations/seats', () => ({ reconcileOrganizationSeats: mocks.seats }))
vi.mock('@/ee/scim/lib/managed-membership', () => ({ assertMembershipNotScimManaged: mocks.scim }))

import { ForbiddenOperationError } from '@/lib/core/application/forbidden'
import {
  removeOrganizationMemberRecord,
  updateOrganizationMemberRecord,
} from '@/lib/organizations/member-manager'

const input = {
  organizationId: 'org',
  actorUserId: 'actor',
  userId: 'target',
  role: 'admin' as const,
}
const target = {
  id: 'membership',
  userId: 'target',
  organizationId: 'org',
  role: 'member',
  userName: 'Member',
  userEmail: 'person@example.com',
  createdAt: new Date(),
}
beforeEach(() => {
  vi.resetAllMocks()
  resetDbChainMock()
  mocks.remove.mockResolvedValue({ success: true })
  mocks.seats.mockResolvedValue({ changed: false })
})
describe('organization member managers', () => {
  it('rejects a demoted actor under the mutation lock', async () => {
    queueTableRows(member, [{ role: 'member' }])
    await expect(updateOrganizationMemberRecord(input)).rejects.toMatchObject({
      code: 'forbidden',
      detailCode: 'ORGANIZATION_ADMIN_REQUIRED',
    })
    expect(mocks.locks.mock.invocationCallOrder[0]).toBeLessThan(
      dbChainMockFns.select.mock.invocationCallOrder[0]
    )
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('keeps owner protection and SCIM authority in the locked mutation', async () => {
    queueTableRows(member, [{ role: 'admin' }])
    queueTableRows(member, [{ ...target, role: 'owner' }])
    await expect(updateOrganizationMemberRecord(input)).rejects.toMatchObject({
      code: 'validation',
    })
    queueTableRows(member, [{ role: 'admin' }])
    queueTableRows(member, [target])
    mocks.scim.mockRejectedValue(
      new ForbiddenOperationError('SCIM_MANAGED_MEMBERSHIP', 'Managed by SCIM')
    )
    await expect(updateOrganizationMemberRecord(input)).rejects.toMatchObject({
      detailCode: 'SCIM_MANAGED_MEMBERSHIP',
    })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('returns unchanged when the role is already current', async () => {
    queueTableRows(member, [{ role: 'admin' }])
    queueTableRows(member, [{ ...target, role: 'admin' }])
    queueTableRows(member, [{ id: 'membership', role: 'admin' }])
    await expect(updateOrganizationMemberRecord(input)).resolves.toMatchObject({
      changed: false,
      previousRole: 'admin',
    })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('preserves successful emergency removal after billing reconciliation fails', async () => {
    queueTableRows(member, [target])
    mocks.seats.mockRejectedValue(new Error('Billing unavailable'))
    await expect(removeOrganizationMemberRecord(input)).resolves.toMatchObject({
      membershipType: 'internal',
      removal: { success: true },
      seatReduction: { changed: false },
    })
    expect(mocks.remove).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: 'actor', memberId: 'membership', onError: 'throw' })
    )
    expect(mocks.scim).not.toHaveBeenCalled()
  })

  it('reports membership added before external-removal preflight as a conflict', async () => {
    queueTableRows(member, [])
    queueTableRows(user, [{ id: 'target', name: 'Person', email: 'person@example.com' }])
    mocks.external.mockResolvedValue({ success: false, error: 'User is an organization member' })

    await expect(removeOrganizationMemberRecord(input)).rejects.toMatchObject({
      code: 'conflict',
      message: 'User is an organization member',
    })
    expect(mocks.remove).not.toHaveBeenCalled()
    expect(mocks.seats).not.toHaveBeenCalled()
  })
})
