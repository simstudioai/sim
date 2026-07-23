/**
 * @vitest-environment node
 */
import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockEnsureUserInOrganizationTx,
  mockSyncUsageLimitsFromSubscription,
  mockReapplyPaidOrgJoinBillingForExistingMemberTx,
  mockAcquireOrganizationMutationLock,
  mockAcquireInvitationMutationLocks,
  mockChangeWorkspaceStoragePayersInTx,
} = vi.hoisted(() => ({
  mockEnsureUserInOrganizationTx: vi.fn(),
  mockSyncUsageLimitsFromSubscription: vi.fn(),
  mockReapplyPaidOrgJoinBillingForExistingMemberTx: vi.fn(),
  mockAcquireOrganizationMutationLock: vi.fn(),
  mockAcquireInvitationMutationLocks: vi.fn(),
  mockChangeWorkspaceStoragePayersInTx: vi.fn(),
}))

vi.mock('@/lib/billing/organizations/membership', () => ({
  acquireOrganizationMutationLock: mockAcquireOrganizationMutationLock,
  ensureUserInOrganizationTx: mockEnsureUserInOrganizationTx,
  reapplyPaidOrgJoinBillingForExistingMemberTx: mockReapplyPaidOrgJoinBillingForExistingMemberTx,
}))

vi.mock('@/lib/billing/storage/payer-transfer', () => ({
  changeWorkspaceStoragePayersInTx: mockChangeWorkspaceStoragePayersInTx,
}))

vi.mock('@/lib/invitations/locks', () => ({
  acquireInvitationMutationLocks: mockAcquireInvitationMutationLocks,
}))

vi.mock('@/lib/billing/core/usage', () => ({
  syncUsageLimitsFromSubscription: mockSyncUsageLimitsFromSubscription,
}))

vi.mock('@sim/utils/id', () => ({
  generateId: vi.fn().mockReturnValue('generated-id'),
  generateShortId: vi.fn().mockReturnValue('short-id'),
}))

import {
  attachOwnedWorkspacesToOrganization,
  detachOrganizationWorkspaces,
  WorkspaceOrganizationMembershipConflictError,
} from '@/lib/workspaces/organization-workspaces'

describe('organization workspace helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockEnsureUserInOrganizationTx.mockReset()
    mockChangeWorkspaceStoragePayersInTx.mockReset()
    mockSyncUsageLimitsFromSubscription.mockResolvedValue(undefined)
    mockReapplyPaidOrgJoinBillingForExistingMemberTx.mockResolvedValue({
      proUsageSnapshotted: false,
      proCancelledAtPeriodEnd: false,
    })
  })

  afterAll(() => {
    resetDbChainMock()
  })

  it('attaches owned workspaces to an organization and syncs existing members', async () => {
    queueTableRows(schemaMock.workspace, [{ id: 'ws-1' }, { id: 'ws-2' }])
    queueTableRows(schemaMock.workspace, [{ id: 'ws-1' }, { id: 'ws-2' }])
    queueTableRows(schemaMock.workspace, [
      { id: 'ws-1', billedAccountUserId: 'user-1', organizationId: null },
      { id: 'ws-2', billedAccountUserId: 'user-1', organizationId: null },
    ])
    queueTableRows(schemaMock.member, [{ userId: 'owner-1' }])
    queueTableRows(schemaMock.permissions, [{ userId: 'owner-1' }, { userId: 'member-1' }])
    queueTableRows(schemaMock.member, [{ userId: 'owner-1', organizationId: 'org-1' }])
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'ws-2' }, { id: 'ws-1' }])
    mockEnsureUserInOrganizationTx
      .mockResolvedValueOnce({
        success: true,
        alreadyMember: false,
        memberId: 'member-1',
        billingActions: {
          proUsageSnapshotted: false,
          proCancelledAtPeriodEnd: false,
        },
      })
      .mockResolvedValueOnce({
        success: true,
        alreadyMember: true,
        billingActions: {
          proUsageSnapshotted: false,
          proCancelledAtPeriodEnd: false,
        },
      })

    const result = await attachOwnedWorkspacesToOrganization({
      ownerUserId: 'user-1',
      organizationId: 'org-1',
    })

    expect(result.attachedWorkspaceIds).toEqual(['ws-1', 'ws-2'])
    expect(result.addedMemberIds).toEqual(['member-1'])
    expect(result.skippedMembers).toEqual([])
    expect(mockEnsureUserInOrganizationTx).toHaveBeenCalledWith(expect.anything(), {
      userId: 'owner-1',
      organizationId: 'org-1',
      role: 'owner',
      skipSeatValidation: true,
    })
    expect(mockEnsureUserInOrganizationTx).toHaveBeenCalledWith(expect.anything(), {
      userId: 'member-1',
      organizationId: 'org-1',
      role: 'member',
      skipSeatValidation: true,
    })
    expect(mockSyncUsageLimitsFromSubscription).toHaveBeenCalledWith('member-1')
    expect(mockReapplyPaidOrgJoinBillingForExistingMemberTx).toHaveBeenCalledWith(
      expect.anything(),
      'owner-1',
      'org-1'
    )
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ organizationAssignedAt: expect.any(Date) })
    )
    expect(mockChangeWorkspaceStoragePayersInTx).toHaveBeenCalledTimes(1)
    expect(dbChainMockFns.for.mock.invocationCallOrder[0]).toBeLessThan(
      mockEnsureUserInOrganizationTx.mock.invocationCallOrder[0]
    )
    expect(mockChangeWorkspaceStoragePayersInTx).toHaveBeenCalledWith(expect.anything(), [
      {
        workspaceId: 'ws-1',
        organizationId: 'org-1',
        billedAccountUserId: 'owner-1',
        expectedCurrentPayer: {
          organizationId: null,
          billedAccountUserId: 'user-1',
        },
      },
      {
        workspaceId: 'ws-2',
        organizationId: 'org-1',
        billedAccountUserId: 'owner-1',
        expectedCurrentPayer: {
          organizationId: null,
          billedAccountUserId: 'user-1',
        },
      },
    ])
    expect(dbChainMockFns.update).toHaveBeenCalledTimes(1)
    expect(dbChainMockFns.insert).toHaveBeenCalledTimes(1)
    expect(dbChainMockFns.values).toHaveBeenCalledWith([
      expect.objectContaining({ entityId: 'ws-1', userId: 'owner-1' }),
      expect.objectContaining({ entityId: 'ws-2', userId: 'owner-1' }),
    ])
  })

  it('fails before attaching workspaces when an existing member belongs to another organization', async () => {
    queueTableRows(schemaMock.workspace, [{ id: 'ws-1' }])
    queueTableRows(schemaMock.workspace, [{ id: 'ws-1' }])
    queueTableRows(schemaMock.workspace, [
      { id: 'ws-1', billedAccountUserId: 'user-1', organizationId: null },
    ])
    queueTableRows(schemaMock.member, [{ userId: 'owner-1' }])
    queueTableRows(schemaMock.permissions, [{ userId: 'owner-1' }, { userId: 'member-2' }])
    queueTableRows(schemaMock.member, [{ userId: 'member-2', organizationId: 'org-2' }])

    await expect(
      attachOwnedWorkspacesToOrganization({
        ownerUserId: 'user-1',
        organizationId: 'org-1',
      })
    ).rejects.toBeInstanceOf(WorkspaceOrganizationMembershipConflictError)

    expect(mockEnsureUserInOrganizationTx).not.toHaveBeenCalled()
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('keeps cross-org members external and still attaches when policy is keep-external', async () => {
    queueTableRows(schemaMock.workspace, [{ id: 'ws-1' }])
    queueTableRows(schemaMock.workspace, [{ id: 'ws-1' }])
    queueTableRows(schemaMock.workspace, [
      { id: 'ws-1', billedAccountUserId: 'user-1', organizationId: null },
    ])
    queueTableRows(schemaMock.member, [{ userId: 'owner-1' }])
    queueTableRows(schemaMock.permissions, [{ userId: 'owner-1' }, { userId: 'member-2' }])
    queueTableRows(schemaMock.member, [{ userId: 'member-2', organizationId: 'org-2' }])
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'ws-1' }])
    mockEnsureUserInOrganizationTx.mockResolvedValueOnce({
      success: true,
      alreadyMember: true,
      billingActions: {
        proUsageSnapshotted: false,
        proCancelledAtPeriodEnd: false,
      },
    })

    const result = await attachOwnedWorkspacesToOrganization({
      ownerUserId: 'user-1',
      organizationId: 'org-1',
      externalMemberPolicy: 'keep-external',
    })

    expect(result.attachedWorkspaceIds).toEqual(['ws-1'])
    expect(result.skippedMembers).toEqual([
      {
        userId: 'member-2',
        reason: 'Already a member of another organization; kept as external workspace member',
      },
    ])
    expect(mockEnsureUserInOrganizationTx).toHaveBeenCalledTimes(1)
    expect(mockEnsureUserInOrganizationTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: 'owner-1' })
    )
    expect(dbChainMockFns.update).toHaveBeenCalled()
  })

  it('rolls back membership work when a concurrent move wins before the locked re-read', async () => {
    queueTableRows(schemaMock.workspace, [{ id: 'ws-1' }])
    queueTableRows(schemaMock.workspace, [{ id: 'ws-1' }])
    queueTableRows(schemaMock.workspace, [])

    const result = await attachOwnedWorkspacesToOrganization({
      ownerUserId: 'user-1',
      organizationId: 'org-1',
      externalMemberPolicy: 'keep-external',
    })

    expect(result).toEqual({
      attachedWorkspaceIds: [],
      addedMemberIds: [],
      skippedMembers: [],
    })
    expect(mockAcquireInvitationMutationLocks).toHaveBeenCalledWith(expect.anything(), {
      invitationIds: [],
      workspaceIds: ['ws-1'],
    })
    expect(mockEnsureUserInOrganizationTx).not.toHaveBeenCalled()
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })

  it('does not report a committed attachment as failed when derived usage refresh fails', async () => {
    queueTableRows(schemaMock.workspace, [{ id: 'ws-1' }])
    queueTableRows(schemaMock.workspace, [{ id: 'ws-1' }])
    queueTableRows(schemaMock.workspace, [
      { id: 'ws-1', billedAccountUserId: 'user-1', organizationId: null },
    ])
    queueTableRows(schemaMock.member, [{ userId: 'owner-1' }])
    queueTableRows(schemaMock.permissions, [{ userId: 'member-1' }])
    queueTableRows(schemaMock.member, [])
    mockEnsureUserInOrganizationTx.mockResolvedValueOnce({
      success: true,
      alreadyMember: false,
      memberId: 'member-1',
      billingActions: {
        proUsageSnapshotted: false,
        proCancelledAtPeriodEnd: false,
      },
    })
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'ws-1' }])
    mockSyncUsageLimitsFromSubscription.mockRejectedValueOnce(new Error('refresh failed'))

    await expect(
      attachOwnedWorkspacesToOrganization({
        ownerUserId: 'user-1',
        organizationId: 'org-1',
      })
    ).resolves.toMatchObject({ attachedWorkspaceIds: ['ws-1'] })
  })

  it('detaches organization workspaces into grandfathered shared mode', async () => {
    queueTableRows(schemaMock.member, [{ userId: 'owner-1' }])
    queueTableRows(schemaMock.workspace, [
      { id: 'ws-1', ownerId: 'creator-1', billedAccountUserId: 'old-owner' },
    ])
    queueTableRows(schemaMock.workspace, [{ id: 'ws-1' }])

    const result = await detachOrganizationWorkspaces('org-1')

    expect(result.detachedWorkspaceIds).toEqual(['ws-1'])
    expect(result.billedAccountUserId).toBe('owner-1')
    expect(mockChangeWorkspaceStoragePayersInTx).toHaveBeenCalledTimes(1)
    expect(dbChainMockFns.for.mock.invocationCallOrder[0]).toBeLessThan(
      mockChangeWorkspaceStoragePayersInTx.mock.invocationCallOrder[0]
    )
    expect(mockChangeWorkspaceStoragePayersInTx).toHaveBeenCalledWith(expect.anything(), [
      {
        workspaceId: 'ws-1',
        organizationId: null,
        billedAccountUserId: 'owner-1',
        expectedCurrentPayer: {
          organizationId: 'org-1',
          billedAccountUserId: 'old-owner',
        },
      },
    ])
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceMode: 'grandfathered_shared',
        organizationAssignedAt: null,
      })
    )
    expect(dbChainMockFns.update).toHaveBeenCalledTimes(1)
    expect(dbChainMockFns.insert).toHaveBeenCalledTimes(1)
    expect(dbChainMockFns.values).toHaveBeenCalledWith([
      expect.objectContaining({ entityId: 'ws-1', userId: 'owner-1' }),
    ])
    expect(dbChainMockFns.onConflictDoUpdate).toHaveBeenCalled()
  })
})
