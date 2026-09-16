/**
 * @vitest-environment node
 */
import { db } from '@sim/db'
import { member, user } from '@sim/db/schema'
import {
  auditMock,
  dbChainMockFns,
  queueTableRows,
  resetDbChainMock,
  resetEnvFlagsMock,
  setEnvFlags,
} from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CreatePendingInvitationInput } from '@/lib/invitations/send'

const mocks = vi.hoisted(() => ({
  admin: vi.fn(),
  plan: vi.fn(),
  policy: vi.fn(),
  membership: vi.fn(),
  lockOrg: vi.fn(),
  lockUser: vi.fn(),
  seats: vi.fn(),
  pending: vi.fn(),
  create: vi.fn(),
  send: vi.fn(),
  cancel: vi.fn(),
}))
vi.mock('@sim/audit', () => auditMock)
vi.mock('@/lib/billing/core/organization', () => ({ isOrganizationOwnerOrAdmin: mocks.admin }))
vi.mock('@/lib/billing/core/subscription', () => ({ resolveOrganizationPlan: mocks.plan }))
vi.mock('@/lib/billing/organizations/membership', () => ({
  acquireOrganizationMutationLock: mocks.lockOrg,
  acquireOrganizationUserMutationLocks: mocks.lockUser,
  getUserOrganization: mocks.membership,
}))
vi.mock('@/lib/billing/validation/seat-management', () => ({
  validateSeatAvailability: mocks.seats,
}))
vi.mock('@/ee/access-control/utils/permission-check', () => ({
  validateInvitationsAllowed: mocks.policy,
}))
vi.mock('@/lib/invitations/send', () => ({
  createPendingInvitation: mocks.create,
  sendInvitationEmail: mocks.send,
  cancelPendingInvitation: mocks.cancel,
  findPendingOrganizationInvitation: mocks.pending,
}))

import {
  createOrganizationInvitation,
  prepareOrganizationInvitationContext,
} from '@/lib/invitations/organization-invitations'

const context = {
  organizationId: 'org-target',
  inviterId: 'admin-user',
  inviterName: 'Admin',
  inviterEmail: 'admin@example.com',
}
const revision = new Date('2026-09-07T12:00:00Z')
const create = () =>
  createOrganizationInvitation({ context, email: ' Person@example.com ', role: 'member' })

beforeEach(() => {
  vi.clearAllMocks()
  resetDbChainMock()
  setEnvFlags({ isBillingEnabled: true })
  mocks.admin.mockResolvedValue(true)
  mocks.plan.mockResolvedValue(true)
  mocks.policy.mockResolvedValue(undefined)
  mocks.membership.mockResolvedValue(null)
  mocks.pending.mockResolvedValue(null)
  mocks.seats.mockResolvedValue({ canInvite: true })
  mocks.send.mockResolvedValue({ success: true })
  mocks.cancel.mockResolvedValue(true)
  mocks.create.mockImplementation(async (input: CreatePendingInvitationInput) => {
    await input.validateLockedContext?.({
      tx: db,
      organizationId: input.organizationId,
      workspaceIds: [],
    })
    return {
      invitationId: 'invite-new',
      token: 'synthetic-token',
      created: true,
      grants: [],
      mutationUpdatedAt: revision,
      mutationOrganizationId: 'org-target',
    }
  })
})
afterEach(() => {
  resetDbChainMock()
  resetEnvFlagsMock()
})

describe('organization-only invitations', () => {
  it('requires authority in the explicitly routed organization before policy or plan reads', async () => {
    mocks.admin.mockResolvedValue(false)
    await expect(prepareOrganizationInvitationContext(context)).rejects.toThrow(
      'Only organization owners and admins'
    )
    expect(mocks.admin).toHaveBeenCalledWith('admin-user', 'org-target')
    expect(mocks.policy).not.toHaveBeenCalled()
    expect(mocks.plan).not.toHaveBeenCalled()
  })

  it('enforces organization invitation policy and active plan', async () => {
    mocks.plan.mockResolvedValue(false)
    await expect(prepareOrganizationInvitationContext(context)).rejects.toThrow('active paid plan')
    expect(mocks.policy).toHaveBeenCalledWith('admin-user', { organizationId: 'org-target' })
    setEnvFlags({ isBillingEnabled: false })
    await expect(prepareOrganizationInvitationContext(context)).resolves.toEqual(context)
  })

  it('creates no workspace grants and rechecks target-org admin and seats under the lock', async () => {
    queueTableRows(member, [{ role: 'admin' }])
    const result = await create()
    expect(result).toMatchObject({
      email: 'person@example.com',
      workspaceIds: [],
      membershipIntent: 'internal',
    })
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'organization',
        role: 'member',
        grants: [],
        organizationId: 'org-target',
      })
    )
    expect(mocks.lockOrg).toHaveBeenCalledWith(db, 'org-target')
    expect(mocks.seats).toHaveBeenCalledWith('org-target', 1, { executor: db })
    expect(dbChainMockFns.where).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'and',
        conditions: [
          { type: 'eq', left: member.organizationId, right: 'org-target' },
          { type: 'eq', left: member.userId, right: 'admin-user' },
        ],
      })
    )
    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'organization', grants: [], email: 'person@example.com' })
    )
    expect(auditMock.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: 'admin-user', resourceId: 'org-target' })
    )
  })

  it('refuses an admin whose role changed while sending', async () => {
    queueTableRows(member, [{ role: 'member' }])
    await expect(create()).rejects.toThrow('organization role changed')
    expect(mocks.send).not.toHaveBeenCalled()
    expect(mocks.seats).not.toHaveBeenCalled()
  })

  it.each(['org-target', 'org-other'])(
    'does not silently convert an existing %s member into an external invite',
    async (organizationId) => {
      queueTableRows(user, [{ id: 'existing-user' }])
      mocks.membership.mockResolvedValue({
        organizationId,
        role: 'member',
        memberId: 'existing-member',
      })
      await expect(create()).rejects.toThrow(
        organizationId === 'org-target' ? 'already a member' : 'already belongs'
      )
      expect(mocks.create).not.toHaveBeenCalled()
    }
  )

  it('rechecks the existing invitee membership under the organization/user lock', async () => {
    queueTableRows(user, [{ id: 'existing-user' }])
    queueTableRows(member, [{ role: 'owner' }])
    mocks.membership
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ organizationId: 'org-other' })
    await expect(create()).rejects.toThrow('invitee joined an organization')
    expect(mocks.lockUser).toHaveBeenCalledWith(db, {
      userId: 'existing-user',
      organizationIds: ['org-target'],
    })
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it('refuses duplicate pending invitations without resending or modifying them', async () => {
    queueTableRows(member, [{ role: 'owner' }])
    mocks.pending.mockResolvedValue({ id: 'existing-invite' })
    await expect(create()).rejects.toThrow('already has a pending invitation')
    expect(mocks.send).not.toHaveBeenCalled()
    expect(mocks.cancel).not.toHaveBeenCalled()
  })

  it('refuses exhausted seats before delivery', async () => {
    queueTableRows(member, [{ role: 'owner' }])
    mocks.seats.mockResolvedValue({ canInvite: false, reason: 'Seat capacity exhausted' })
    await expect(create()).rejects.toThrow('Seat capacity exhausted')
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it.each(['returned', 'thrown'])(
    'compensates a %s email failure against only its original revision',
    async (failure) => {
      queueTableRows(member, [{ role: 'owner' }])
      if (failure === 'thrown') mocks.send.mockRejectedValue(new Error('Provider failed'))
      else mocks.send.mockResolvedValue({ success: false })
      await expect(create()).rejects.toThrow('could not be delivered')
      expect(mocks.cancel).toHaveBeenCalledWith('invite-new', {
        expectedUpdatedAt: revision,
        expectedOrganizationId: 'org-target',
      })
      expect(auditMock.recordAudit).not.toHaveBeenCalled()
    }
  )

  it('does not undo a concurrently changed invitation after failed delivery', async () => {
    queueTableRows(member, [{ role: 'owner' }])
    mocks.send.mockResolvedValue({ success: false })
    mocks.cancel.mockResolvedValue(false)
    await expect(create()).rejects.toThrow('invitation changed while delivery failed')
    expect(auditMock.recordAudit).not.toHaveBeenCalled()
  })

  it('rejects malformed addresses before provider delivery', async () => {
    await expect(
      createOrganizationInvitation({ context, email: 'not-an-email', role: 'member' })
    ).rejects.toThrow()
    expect(mocks.create).not.toHaveBeenCalled()
  })
})
