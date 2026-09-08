/**
 * @vitest-environment node
 */
import { member, session, user } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockAcquireLocks, mockInvalidateVersion, mockInvalidateMembership } = vi.hoisted(() => ({
  mockAcquireLocks: vi.fn(),
  mockInvalidateVersion: vi.fn(),
  mockInvalidateMembership: vi.fn(),
}))

vi.mock('@/lib/billing/organizations/membership', () => ({
  acquireOrganizationUserMutationLocks: mockAcquireLocks,
}))
vi.mock('@/lib/auth/security-policy', () => ({
  invalidateSecurityPolicyVersionCache: mockInvalidateVersion,
  invalidateMembershipCache: mockInvalidateMembership,
}))

import { db } from '@sim/db'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  changeMemberRoleTx,
  suspendMemberTx,
  unsuspendMemberTx,
} from '@/lib/organizations/members/lifecycle'
import {
  invalidateAfterSessionRevocation,
  revokeUserSessionsTx,
} from '@/lib/organizations/members/revocation'

afterAll(resetDbChainMock)

beforeEach(() => {
  vi.clearAllMocks()
  resetDbChainMock()
})

describe('changeMemberRoleTx', () => {
  it('takes the organization and user locks before reading the membership', async () => {
    queueTableRows(member, [{ id: 'm-1', role: 'member' }])
    await changeMemberRoleTx(db, { organizationId: 'org-1', userId: 'u-1', role: 'admin' })
    expect(mockAcquireLocks).toHaveBeenCalledWith(db, {
      userId: 'u-1',
      organizationIds: ['org-1'],
    })
    expect(mockAcquireLocks.mock.invocationCallOrder[0]).toBeLessThan(
      dbChainMockFns.select.mock.invocationCallOrder[0]
    )
  })

  it('reports the change it made', async () => {
    queueTableRows(member, [{ id: 'm-1', role: 'member' }])
    await expect(
      changeMemberRoleTx(db, { organizationId: 'org-1', userId: 'u-1', role: 'admin' })
    ).resolves.toEqual({ changed: true, from: 'member', to: 'admin' })
    expect(dbChainMockFns.update).toHaveBeenCalledWith(member)
    expect(dbChainMockFns.set).toHaveBeenCalledWith({ role: 'admin' })
  })

  it('writes nothing when the role already matches', async () => {
    queueTableRows(member, [{ id: 'm-1', role: 'admin' }])
    await expect(
      changeMemberRoleTx(db, { organizationId: 'org-1', userId: 'u-1', role: 'admin' })
    ).resolves.toEqual({ changed: false, role: 'admin' })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('refuses to touch the owner and reports a missing member', async () => {
    queueTableRows(member, [{ id: 'm-1', role: 'owner' }])
    const owner = await changeMemberRoleTx(db, {
      organizationId: 'org-1',
      userId: 'u-1',
      role: 'member',
    }).catch((error) => error)
    expect(owner).toBeInstanceOf(OrchestrationError)
    expect(owner.code).toBe('conflict')

    const missing = await changeMemberRoleTx(db, {
      organizationId: 'org-1',
      userId: 'u-2',
      role: 'member',
    }).catch((error) => error)
    expect(missing.code).toBe('not_found')
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })
})

describe('revokeUserSessionsTx', () => {
  it('deletes the user’s own sessions and bumps the organization security version together', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 's-1' }, { id: 's-2' }])
    await expect(
      revokeUserSessionsTx(db, { userId: 'u-1', organizationId: 'org-1' })
    ).resolves.toEqual({ revoked: 2 })
    expect(dbChainMockFns.delete).toHaveBeenCalledWith(session)
    expect(dbChainMockFns.where).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'and',
        conditions: expect.arrayContaining([
          { type: 'eq', left: session.userId, right: 'u-1' },
          { type: 'isNull', column: session.impersonatedBy },
        ]),
      })
    )
    expect(dbChainMockFns.update).toHaveBeenCalledTimes(1)
  })

  it('spares the session token the caller is still using', async () => {
    await revokeUserSessionsTx(db, {
      userId: 'u-1',
      organizationId: 'org-1',
      spareSessionToken: 'keep-me',
    })
    expect(dbChainMockFns.where).toHaveBeenCalledWith(
      expect.objectContaining({
        conditions: expect.arrayContaining([{ type: 'ne', left: session.token, right: 'keep-me' }]),
      })
    )
  })

  it('clears the caches only through the separate post-commit step', () => {
    invalidateAfterSessionRevocation({ userId: 'u-1', organizationId: 'org-1' })
    expect(mockInvalidateVersion).toHaveBeenCalledWith('org-1')
    expect(mockInvalidateMembership).toHaveBeenCalledWith('u-1')
  })
})

describe('suspendMemberTx and unsuspendMemberTx', () => {
  beforeEach(() => {
    queueTableRows(member, [{ role: 'member' }])
  })

  it('suspends once, revokes sessions, and never touches API keys', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'u-1' }])
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 's-1' }])
    await expect(
      suspendMemberTx(db, { userId: 'u-1', organizationId: 'org-1', source: 'scim' })
    ).resolves.toEqual({ suspended: true, sessionsRevoked: 1 })
    expect(mockAcquireLocks).toHaveBeenCalledTimes(1)
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ suspensionSource: 'scim', suspendedAt: expect.any(Date) })
    )
    expect(dbChainMockFns.delete).toHaveBeenCalledTimes(1)
    expect(dbChainMockFns.delete).toHaveBeenCalledWith(session)
  })

  it('reports an already-suspended account without claiming a second suspension', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([])
    await expect(
      suspendMemberTx(db, { userId: 'u-1', organizationId: 'org-1', source: 'scim' })
    ).resolves.toMatchObject({ suspended: false })
  })

  it('refuses to suspend the owner under the membership lock without changing access', async () => {
    resetDbChainMock()
    queueTableRows(member, [{ role: 'owner' }])
    await expect(
      suspendMemberTx(db, { userId: 'u-1', organizationId: 'org-1', source: 'scim' })
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(mockAcquireLocks.mock.invocationCallOrder[0]).toBeLessThan(
      dbChainMockFns.select.mock.invocationCallOrder[0]
    )
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
  })

  it('cannot suspend an account outside the asserted organization', async () => {
    resetDbChainMock()
    await expect(
      suspendMemberTx(db, { userId: 'u-1', organizationId: 'org-2', source: 'scim' })
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('lifts only a suspension raised by the same source', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'u-1' }])
    await expect(unsuspendMemberTx(db, { userId: 'u-1', source: 'scim' })).resolves.toEqual({
      unsuspended: true,
    })
    expect(dbChainMockFns.update).toHaveBeenCalledWith(user)
    expect(dbChainMockFns.where).toHaveBeenCalledWith({
      type: 'and',
      conditions: [
        { type: 'eq', left: user.id, right: 'u-1' },
        { type: 'eq', left: user.suspensionSource, right: 'scim' },
      ],
    })
  })
})
