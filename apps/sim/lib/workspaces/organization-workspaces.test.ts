/**
 * @vitest-environment node
 */
import { schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockDbResults,
  mockUpdateWhere,
  mockUpdateReturning,
  mockUpdateSet,
  mockDbUpdate,
  mockOnConflictDoUpdate,
  mockInsertValues,
  mockDbInsert,
  mockEnsureUserInOrganizationTx,
  mockSyncUsageLimitsFromSubscription,
  mockReapplyPaidOrgJoinBillingForExistingMemberTx,
  mockAcquireOrganizationMutationLock,
  mockAcquireInvitationMutationLocks,
  mockChangeWorkspaceStoragePayersInTx,
  mockSelectForUpdate,
} = vi.hoisted(() => {
  const mockDbResults: { value: any[] } = { value: [] }
  const mockUpdateReturning = vi.fn()
  const mockUpdateWhere = vi.fn().mockReturnValue({ returning: mockUpdateReturning })
  const mockUpdateSet = vi.fn().mockReturnValue({ where: mockUpdateWhere })
  const mockDbUpdate = vi.fn().mockReturnValue({ set: mockUpdateSet })
  const mockOnConflictDoUpdate = vi.fn().mockResolvedValue(undefined)
  const mockInsertValues = vi.fn().mockReturnValue({
    onConflictDoUpdate: mockOnConflictDoUpdate,
  })
  const mockDbInsert = vi.fn().mockReturnValue({ values: mockInsertValues })
  const mockEnsureUserInOrganizationTx = vi.fn()
  const mockSyncUsageLimitsFromSubscription = vi.fn().mockResolvedValue(undefined)
  const mockReapplyPaidOrgJoinBillingForExistingMemberTx = vi.fn().mockResolvedValue({
    proUsageSnapshotted: false,
    proCancelledAtPeriodEnd: false,
  })
  const mockAcquireOrganizationMutationLock = vi.fn()
  const mockAcquireInvitationMutationLocks = vi.fn()
  const mockChangeWorkspaceStoragePayersInTx = vi.fn()
  const mockSelectForUpdate = vi.fn()

  return {
    mockDbResults,
    mockUpdateWhere,
    mockUpdateReturning,
    mockUpdateSet,
    mockDbUpdate,
    mockOnConflictDoUpdate,
    mockInsertValues,
    mockDbInsert,
    mockEnsureUserInOrganizationTx,
    mockSyncUsageLimitsFromSubscription,
    mockReapplyPaidOrgJoinBillingForExistingMemberTx,
    mockAcquireOrganizationMutationLock,
    mockAcquireInvitationMutationLocks,
    mockChangeWorkspaceStoragePayersInTx,
    mockSelectForUpdate,
  }
})

vi.mock('@sim/db', () => {
  const selectImpl = vi.fn().mockImplementation(() => {
    const chain: any = {}
    chain.from = vi.fn().mockReturnValue(chain)
    chain.where = vi.fn().mockReturnValue(chain)
    chain.orderBy = vi.fn().mockReturnValue(chain)
    chain.for = vi.fn().mockImplementation(() => {
      mockSelectForUpdate()
      return chain
    })
    chain.limit = vi
      .fn()
      .mockImplementation(() => Promise.resolve(mockDbResults.value.shift() || []))
    chain.then = vi.fn().mockImplementation((callback: (rows: any[]) => unknown) => {
      const result = mockDbResults.value.shift() || []
      return Promise.resolve(callback ? callback(result) : result)
    })
    return chain
  })
  const txObject = {
    select: selectImpl,
    update: mockDbUpdate,
    insert: mockDbInsert,
  }
  return {
    db: {
      select: selectImpl,
      update: mockDbUpdate,
      insert: mockDbInsert,
      transaction: vi.fn(async (fn: (tx: typeof txObject) => unknown) => fn(txObject)),
    },
  }
})

vi.mock('@sim/db/schema', () => schemaMock)

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
    mockDbResults.value = []
    mockEnsureUserInOrganizationTx.mockReset()
    mockUpdateReturning.mockReset()
    mockChangeWorkspaceStoragePayersInTx.mockReset()
    mockSyncUsageLimitsFromSubscription.mockResolvedValue(undefined)
  })

  it('attaches owned workspaces to an organization and syncs existing members', async () => {
    mockDbResults.value = [
      [{ id: 'ws-1' }, { id: 'ws-2' }],
      [{ id: 'ws-1' }, { id: 'ws-2' }],
      [
        { id: 'ws-1', billedAccountUserId: 'user-1', organizationId: null },
        { id: 'ws-2', billedAccountUserId: 'user-1', organizationId: null },
      ],
      [{ userId: 'owner-1' }],
      [{ userId: 'owner-1' }, { userId: 'member-1' }],
      [{ userId: 'owner-1', organizationId: 'org-1' }],
    ]
    mockUpdateReturning.mockResolvedValueOnce([{ id: 'ws-2' }, { id: 'ws-1' }])
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
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ organizationAssignedAt: expect.any(Date) })
    )
    expect(mockChangeWorkspaceStoragePayersInTx).toHaveBeenCalledTimes(1)
    expect(mockSelectForUpdate.mock.invocationCallOrder[0]).toBeLessThan(
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
    expect(mockDbUpdate).toHaveBeenCalledTimes(1)
    expect(mockDbInsert).toHaveBeenCalledTimes(1)
    expect(mockInsertValues).toHaveBeenCalledWith([
      expect.objectContaining({ entityId: 'ws-1', userId: 'owner-1' }),
      expect.objectContaining({ entityId: 'ws-2', userId: 'owner-1' }),
    ])
  })

  it('fails before attaching workspaces when an existing member belongs to another organization', async () => {
    mockDbResults.value = [
      [{ id: 'ws-1' }],
      [{ id: 'ws-1' }],
      [{ id: 'ws-1', billedAccountUserId: 'user-1', organizationId: null }],
      [{ userId: 'owner-1' }],
      [{ userId: 'owner-1' }, { userId: 'member-2' }],
      [{ userId: 'member-2', organizationId: 'org-2' }],
    ]

    await expect(
      attachOwnedWorkspacesToOrganization({
        ownerUserId: 'user-1',
        organizationId: 'org-1',
      })
    ).rejects.toBeInstanceOf(WorkspaceOrganizationMembershipConflictError)

    expect(mockEnsureUserInOrganizationTx).not.toHaveBeenCalled()
    expect(mockDbUpdate).not.toHaveBeenCalled()
  })

  it('keeps cross-org members external and still attaches when policy is keep-external', async () => {
    mockDbResults.value = [
      [{ id: 'ws-1' }],
      [{ id: 'ws-1' }],
      [{ id: 'ws-1', billedAccountUserId: 'user-1', organizationId: null }],
      [{ userId: 'owner-1' }],
      [{ userId: 'owner-1' }, { userId: 'member-2' }],
      [{ userId: 'member-2', organizationId: 'org-2' }],
    ]
    mockUpdateReturning.mockResolvedValueOnce([{ id: 'ws-1' }])
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
    expect(mockDbUpdate).toHaveBeenCalled()
  })

  it('rolls back membership work when a concurrent move wins before the locked re-read', async () => {
    mockDbResults.value = [[{ id: 'ws-1' }], [{ id: 'ws-1' }], []]

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
    expect(mockDbUpdate).not.toHaveBeenCalled()
    expect(mockDbInsert).not.toHaveBeenCalled()
  })

  it('does not report a committed attachment as failed when derived usage refresh fails', async () => {
    mockDbResults.value = [
      [{ id: 'ws-1' }],
      [{ id: 'ws-1' }],
      [{ id: 'ws-1', billedAccountUserId: 'user-1', organizationId: null }],
      [{ userId: 'owner-1' }],
      [{ userId: 'member-1' }],
      [],
    ]
    mockEnsureUserInOrganizationTx.mockResolvedValueOnce({
      success: true,
      alreadyMember: false,
      memberId: 'member-1',
      billingActions: {
        proUsageSnapshotted: false,
        proCancelledAtPeriodEnd: false,
      },
    })
    mockUpdateReturning.mockResolvedValueOnce([{ id: 'ws-1' }])
    mockSyncUsageLimitsFromSubscription.mockRejectedValueOnce(new Error('refresh failed'))

    await expect(
      attachOwnedWorkspacesToOrganization({
        ownerUserId: 'user-1',
        organizationId: 'org-1',
      })
    ).resolves.toMatchObject({ attachedWorkspaceIds: ['ws-1'] })
  })

  it('detaches organization workspaces into grandfathered shared mode', async () => {
    mockDbResults.value = [
      [{ userId: 'owner-1' }],
      [{ id: 'ws-1', ownerId: 'creator-1', billedAccountUserId: 'old-owner' }],
      [{ id: 'ws-1' }],
    ]

    const result = await detachOrganizationWorkspaces('org-1')

    expect(result.detachedWorkspaceIds).toEqual(['ws-1'])
    expect(result.billedAccountUserId).toBe('owner-1')
    expect(mockChangeWorkspaceStoragePayersInTx).toHaveBeenCalledTimes(1)
    expect(mockSelectForUpdate.mock.invocationCallOrder[0]).toBeLessThan(
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
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceMode: 'grandfathered_shared',
        organizationAssignedAt: null,
      })
    )
    expect(mockDbUpdate).toHaveBeenCalledTimes(1)
    expect(mockDbInsert).toHaveBeenCalledTimes(1)
    expect(mockInsertValues).toHaveBeenCalledWith([
      expect.objectContaining({ entityId: 'ws-1', userId: 'owner-1' }),
    ])
    expect(mockOnConflictDoUpdate).toHaveBeenCalled()
  })
})
