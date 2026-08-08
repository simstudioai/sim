/**
 * @vitest-environment node
 */
import { member, workspace } from '@sim/db/schema'
import {
  dbChainMock,
  queueTableRows,
  resetDbChainMock,
  resetEnvFlagsMock,
  setEnvFlags,
} from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DbOrTx } from '@/lib/db/types'

const {
  mockAcquireOrganizationUserMutationLocks,
  mockGetUserOrganization,
  mockGetOrganizationSubscription,
  mockGetHighestPrioritySubscription,
} = vi.hoisted(() => ({
  mockAcquireOrganizationUserMutationLocks: vi.fn(),
  mockGetUserOrganization: vi.fn(),
  mockGetOrganizationSubscription: vi.fn(),
  mockGetHighestPrioritySubscription: vi.fn(),
}))

vi.mock('@/lib/billing/organizations/membership', () => ({
  acquireOrganizationUserMutationLocks: mockAcquireOrganizationUserMutationLocks,
  getUserOrganization: mockGetUserOrganization,
}))

vi.mock('@/lib/billing/core/billing', () => ({
  getOrganizationSubscription: mockGetOrganizationSubscription,
}))

vi.mock('@/lib/billing/core/plan', () => ({
  getHighestPrioritySubscription: mockGetHighestPrioritySubscription,
}))

import {
  getOrganizationOwnerId,
  getWorkspaceCreationPolicy,
  getWorkspaceInvitePolicy,
  lockWorkspaceCreationContext,
  WORKSPACE_MODE,
  WorkspaceCreationContextChangedError,
} from '@/lib/workspaces/policy'
import { UPGRADE_TO_INVITE_REASON } from '@/lib/workspaces/policy-constants'

afterAll(resetDbChainMock)

afterAll(resetEnvFlagsMock)

describe('getOrganizationOwnerId', () => {
  it('uses the supplied transaction executor for the owner lookup', async () => {
    const limit = vi.fn().mockResolvedValue([{ userId: 'owner-from-transaction' }])
    const where = vi.fn().mockReturnValue({ limit })
    const from = vi.fn().mockReturnValue({ where })
    const select = vi.fn().mockReturnValue({ from })
    const executor = { select } as unknown as DbOrTx

    await expect(getOrganizationOwnerId('org-1', executor)).resolves.toBe('owner-from-transaction')
    expect(select).toHaveBeenCalledWith({ userId: member.userId })
    expect(from).toHaveBeenCalledWith(member)
    expect(where).toHaveBeenCalledOnce()
    expect(limit).toHaveBeenCalledWith(1)
  })
})

describe('lockWorkspaceCreationContext', () => {
  it('locks the destination organization and user before rejecting a stale org-mode policy', async () => {
    vi.clearAllMocks()
    mockAcquireOrganizationUserMutationLocks.mockResolvedValue(undefined)
    mockGetUserOrganization.mockResolvedValue(null)
    const tx = {} as DbOrTx

    await expect(
      lockWorkspaceCreationContext(tx, {
        userId: 'user-1',
        organizationId: 'org-1',
        observedOrganizationId: 'org-1',
      })
    ).rejects.toBeInstanceOf(WorkspaceCreationContextChangedError)

    expect(mockAcquireOrganizationUserMutationLocks).toHaveBeenCalledWith(tx, {
      userId: 'user-1',
      organizationIds: ['org-1'],
    })
    expect(mockGetUserOrganization).toHaveBeenCalledWith('user-1', tx)
    expect(mockAcquireOrganizationUserMutationLocks.mock.invocationCallOrder[0]).toBeLessThan(
      mockGetUserOrganization.mock.invocationCallOrder[0]
    )
  })

  it('uses the live owner after the org lock and row-locks the current entitlement', async () => {
    vi.clearAllMocks()
    resetDbChainMock()
    setEnvFlags({ isBillingEnabled: true })
    mockAcquireOrganizationUserMutationLocks.mockResolvedValue(undefined)
    mockGetUserOrganization.mockResolvedValue({
      organizationId: 'org-1',
      role: 'admin',
    })
    mockGetOrganizationSubscription.mockResolvedValue({
      id: 'sub-1',
      referenceId: 'org-1',
      plan: 'team_6000',
      status: 'active',
    })
    queueTableRows(member, [{ userId: 'new-owner' }])
    const tx = dbChainMock.db as unknown as DbOrTx

    await expect(
      lockWorkspaceCreationContext(tx, {
        userId: 'creator-1',
        organizationId: 'org-1',
        observedOrganizationId: 'org-1',
      })
    ).resolves.toEqual({ billedAccountUserId: 'new-owner' })

    expect(mockGetOrganizationSubscription).toHaveBeenCalledWith('org-1', {
      executor: tx,
      onError: 'throw',
      forUpdate: true,
    })
    expect(mockAcquireOrganizationUserMutationLocks.mock.invocationCallOrder[0]).toBeLessThan(
      mockGetOrganizationSubscription.mock.invocationCallOrder[0]
    )
  })

  it('rejects when the paid org entitlement disappeared before insertion', async () => {
    vi.clearAllMocks()
    resetDbChainMock()
    setEnvFlags({ isBillingEnabled: true })
    mockAcquireOrganizationUserMutationLocks.mockResolvedValue(undefined)
    mockGetUserOrganization.mockResolvedValue({
      organizationId: 'org-1',
      role: 'owner',
    })
    mockGetOrganizationSubscription.mockResolvedValue(null)
    const tx = dbChainMock.db as unknown as DbOrTx

    await expect(
      lockWorkspaceCreationContext(tx, {
        userId: 'creator-1',
        organizationId: 'org-1',
        observedOrganizationId: 'org-1',
      })
    ).rejects.toBeInstanceOf(WorkspaceCreationContextChangedError)
  })
})

describe('getWorkspaceCreationPolicy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    setEnvFlags({ isBillingEnabled: true })
    mockGetUserOrganization.mockResolvedValue(null)
    mockGetOrganizationSubscription.mockResolvedValue(null)
    mockGetHighestPrioritySubscription.mockResolvedValue(null)
  })

  it('blocks free users once they already own one non-organization workspace', async () => {
    queueTableRows(workspace, [{ value: 1 }])

    const result = await getWorkspaceCreationPolicy({ userId: 'user-1' })

    expect(result.canCreate).toBe(false)
    expect(result.workspaceMode).toBe(WORKSPACE_MODE.PERSONAL)
    expect(result.maxWorkspaces).toBe(1)
    expect(result.currentWorkspaceCount).toBe(1)
  })

  it('blocks a plain member of a lapsed organization from creating anything', async () => {
    mockGetUserOrganization.mockResolvedValue({
      organizationId: 'org-1',
      role: 'member',
      memberId: 'member-1',
    })
    // Cancelled / past_due Team: no usable organization subscription.
    mockGetOrganizationSubscription.mockResolvedValue({
      id: 'sub-1',
      plan: 'team_6000',
      status: 'canceled',
      referenceId: 'org-1',
    })
    queueTableRows(member, [{ role: 'member' }])

    const result = await getWorkspaceCreationPolicy({ userId: 'user-1' })

    expect(result.canCreate).toBe(false)
    expect(result.blockedReasonCode).toBe('organization-subscription-inactive')
    expect(result.status).toBe(403)
  })

  it('lets an owner of a lapsed organization fall back to their personal plan', async () => {
    mockGetUserOrganization.mockResolvedValue({
      organizationId: 'org-1',
      role: 'owner',
      memberId: 'member-1',
    })
    mockGetOrganizationSubscription.mockResolvedValue({
      id: 'sub-1',
      plan: 'team_6000',
      status: 'canceled',
      referenceId: 'org-1',
    })
    mockGetHighestPrioritySubscription.mockResolvedValue({
      id: 'sub-2',
      plan: 'pro_6000',
      status: 'active',
    })
    queueTableRows(member, [{ role: 'owner' }])
    queueTableRows(workspace, [{ value: 0 }])

    const result = await getWorkspaceCreationPolicy({ userId: 'user-1' })

    expect(result.canCreate).toBe(true)
    expect(result.workspaceMode).toBe(WORKSPACE_MODE.PERSONAL)
    expect(result.maxWorkspaces).toBe(3)
    // The membership snapshot lets creation tell "already a member" apart from
    // "joined mid-create", so the owner is not spuriously 409'd.
    expect(result.observedOrganizationId).toBe('org-1')
  })

  it('allows pro users to create up to three personal workspaces', async () => {
    mockGetHighestPrioritySubscription.mockResolvedValueOnce({
      id: 'sub-1',
      plan: 'pro_6000',
      status: 'active',
    })
    queueTableRows(workspace, [{ value: 2 }])

    const result = await getWorkspaceCreationPolicy({ userId: 'user-1' })

    expect(result.canCreate).toBe(true)
    expect(result.workspaceMode).toBe(WORKSPACE_MODE.PERSONAL)
    expect(result.maxWorkspaces).toBe(3)
    expect(result.currentWorkspaceCount).toBe(2)
  })

  it('allows max users to create up to ten personal workspaces', async () => {
    mockGetHighestPrioritySubscription.mockResolvedValueOnce({
      id: 'sub-1',
      plan: 'pro_25000',
      status: 'active',
    })
    queueTableRows(workspace, [{ value: 5 }])

    const result = await getWorkspaceCreationPolicy({ userId: 'user-1' })

    expect(result.canCreate).toBe(true)
    expect(result.workspaceMode).toBe(WORKSPACE_MODE.PERSONAL)
    expect(result.maxWorkspaces).toBe(10)
    expect(result.currentWorkspaceCount).toBe(5)
  })

  // The Max cap previously read `isMax`, which required `isPro` and so excluded
  // both `team_25000` and `enterprise`. Those tiers fell to the `isPro ? 3 : 1`
  // branch and got ONE personal workspace — fewer than a plain Pro's three.
  it('gives the team plan at the Max credit tier the same ten personal workspaces as Max', async () => {
    mockGetUserOrganization.mockResolvedValue({
      organizationId: 'org-1',
      role: 'owner',
      memberId: 'member-1',
    })
    // A past_due org subscription is not `hasUsableSubscriptionStatus`, so the
    // organization branch does not apply and the personal cap decides.
    mockGetOrganizationSubscription.mockResolvedValue({
      id: 'sub-1',
      plan: 'team_25000',
      status: 'past_due',
    })
    mockGetHighestPrioritySubscription.mockResolvedValueOnce({
      id: 'sub-1',
      plan: 'team_25000',
      status: 'past_due',
    })
    queueTableRows(workspace, [{ value: 5 }])

    const result = await getWorkspaceCreationPolicy({ userId: 'user-1' })

    expect(result.canCreate).toBe(true)
    expect(result.workspaceMode).toBe(WORKSPACE_MODE.PERSONAL)
    expect(result.maxWorkspaces).toBe(10)
  })

  it('gives an enterprise payer ten personal workspaces despite carrying no credit suffix', async () => {
    mockGetHighestPrioritySubscription.mockResolvedValueOnce({
      id: 'sub-1',
      plan: 'enterprise',
      status: 'active',
    })
    queueTableRows(workspace, [{ value: 5 }])

    const result = await getWorkspaceCreationPolicy({ userId: 'user-1' })

    expect(result.canCreate).toBe(true)
    expect(result.workspaceMode).toBe(WORKSPACE_MODE.PERSONAL)
    expect(result.maxWorkspaces).toBe(10)
  })

  // The personal cap is only a fallback: an enterprise org admin is routed to
  // organization mode and is uncapped, which is why the bug above stayed hidden.
  it('leaves enterprise organization workspaces uncapped for org admins', async () => {
    mockGetUserOrganization.mockResolvedValueOnce({
      organizationId: 'org-1',
      role: 'owner',
      memberId: 'member-1',
    })
    mockGetOrganizationSubscription.mockResolvedValueOnce({
      id: 'sub-1',
      plan: 'enterprise',
      status: 'active',
    })
    queueTableRows(member, [{ userId: 'owner-1' }])

    const result = await getWorkspaceCreationPolicy({
      userId: 'user-1',
      activeOrganizationId: 'org-1',
    })

    expect(result.canCreate).toBe(true)
    expect(result.workspaceMode).toBe(WORKSPACE_MODE.ORGANIZATION)
    expect(result.maxWorkspaces).toBeNull()
  })

  it('blocks max users once they already own ten personal workspaces', async () => {
    mockGetHighestPrioritySubscription.mockResolvedValueOnce({
      id: 'sub-1',
      plan: 'pro_25000',
      status: 'active',
    })
    queueTableRows(workspace, [{ value: 10 }])

    const result = await getWorkspaceCreationPolicy({ userId: 'user-1' })

    expect(result.canCreate).toBe(false)
    expect(result.maxWorkspaces).toBe(10)
    expect(result.currentWorkspaceCount).toBe(10)
  })

  it('allows unlimited personal workspaces when billing is disabled', async () => {
    setEnvFlags({ isBillingEnabled: false })
    queueTableRows(workspace, [{ value: 9 }])

    const result = await getWorkspaceCreationPolicy({ userId: 'user-1' })

    expect(result.canCreate).toBe(true)
    expect(result.workspaceMode).toBe(WORKSPACE_MODE.PERSONAL)
    expect(result.maxWorkspaces).toBeNull()
    expect(result.currentWorkspaceCount).toBe(9)
    expect(mockGetHighestPrioritySubscription).not.toHaveBeenCalled()
  })

  it('without pinning, a null active org falls back to the caller membership org', async () => {
    setEnvFlags({ isBillingEnabled: false })
    mockGetUserOrganization.mockResolvedValue({
      organizationId: 'user-org',
      role: 'admin',
      memberId: 'member-1',
    })
    queueTableRows(member, [{ userId: 'owner-1' }])

    const result = await getWorkspaceCreationPolicy({
      userId: 'user-1',
      activeOrganizationId: null,
    })

    expect(result.workspaceMode).toBe(WORKSPACE_MODE.ORGANIZATION)
    expect(result.organizationId).toBe('user-org')
  })

  it('pins to the source org: a personal source (null) stays personal regardless of caller org', async () => {
    setEnvFlags({ isBillingEnabled: false })
    mockGetUserOrganization.mockResolvedValue({
      organizationId: 'user-org',
      role: 'admin',
      memberId: 'member-1',
    })
    queueTableRows(workspace, [{ value: 0 }])

    const result = await getWorkspaceCreationPolicy({
      userId: 'user-1',
      activeOrganizationId: null,
      pinOrganization: true,
    })

    expect(result.canCreate).toBe(true)
    expect(result.workspaceMode).toBe(WORKSPACE_MODE.PERSONAL)
    expect(result.organizationId).toBeNull()
    expect(result.billedAccountUserId).toBe('user-1')
  })

  it('allows org admins on a team plan to create organization workspaces', async () => {
    mockGetUserOrganization.mockResolvedValueOnce({
      organizationId: 'org-1',
      role: 'admin',
      memberId: 'member-1',
    })
    mockGetOrganizationSubscription.mockResolvedValueOnce({
      id: 'sub-1',
      plan: 'team_6000',
      status: 'active',
    })
    queueTableRows(member, [{ userId: 'owner-1' }])

    const result = await getWorkspaceCreationPolicy({
      userId: 'user-1',
      activeOrganizationId: 'org-1',
    })

    expect(result.canCreate).toBe(true)
    expect(result.workspaceMode).toBe(WORKSPACE_MODE.ORGANIZATION)
    expect(result.organizationId).toBe('org-1')
    expect(result.billedAccountUserId).toBe('owner-1')
  })

  it('allows org admins to create organization workspaces when billing is disabled', async () => {
    setEnvFlags({ isBillingEnabled: false })
    mockGetUserOrganization.mockResolvedValueOnce({
      organizationId: 'org-1',
      role: 'admin',
      memberId: 'member-1',
    })
    queueTableRows(member, [{ userId: 'owner-1' }])

    const result = await getWorkspaceCreationPolicy({
      userId: 'user-1',
      activeOrganizationId: 'org-1',
    })

    expect(result.canCreate).toBe(true)
    expect(result.workspaceMode).toBe(WORKSPACE_MODE.ORGANIZATION)
    expect(result.organizationId).toBe('org-1')
    expect(result.billedAccountUserId).toBe('owner-1')
    expect(mockGetOrganizationSubscription).not.toHaveBeenCalled()
  })

  it('allows plain org members to create organization workspaces when billing is disabled', async () => {
    setEnvFlags({ isBillingEnabled: false })
    mockGetUserOrganization.mockResolvedValueOnce({
      organizationId: 'org-1',
      role: 'member',
      memberId: 'member-1',
    })
    queueTableRows(member, [{ userId: 'owner-1' }])

    const result = await getWorkspaceCreationPolicy({
      userId: 'user-1',
      activeOrganizationId: 'org-1',
    })

    /**
     * Auto-joined users — instance-organization mode, or SSO organization
     * provisioning — land here as plain members. Refusing them would leave them
     * with no workspace at all, not merely a personal one.
     */
    expect(result.canCreate).toBe(true)
    expect(result.workspaceMode).toBe(WORKSPACE_MODE.ORGANIZATION)
    expect(result.organizationId).toBe('org-1')
    expect(result.billedAccountUserId).toBe('owner-1')
  })

  it('still blocks non-admin org members when billing is enabled', async () => {
    mockGetUserOrganization.mockResolvedValueOnce({
      organizationId: 'org-1',
      role: 'member',
      memberId: 'member-1',
    })
    mockGetOrganizationSubscription.mockResolvedValueOnce({
      id: 'sub-1',
      plan: 'enterprise',
      status: 'active',
    })
    queueTableRows(member, [{ userId: 'owner-1' }])

    const result = await getWorkspaceCreationPolicy({
      userId: 'user-1',
      activeOrganizationId: 'org-1',
    })

    expect(result.canCreate).toBe(false)
    expect(result.workspaceMode).toBe(WORKSPACE_MODE.ORGANIZATION)
    expect(result.reason).toContain('owners and admins')
  })

  it('blocks users without org membership from creating workspaces in the active org context', async () => {
    queueTableRows(member, [])
    queueTableRows(member, [{ userId: 'owner-1' }])

    const result = await getWorkspaceCreationPolicy({
      userId: 'external-user-1',
      activeOrganizationId: 'org-1',
    })

    expect(result.canCreate).toBe(false)
    expect(result.workspaceMode).toBe(WORKSPACE_MODE.ORGANIZATION)
    expect(result.organizationId).toBe('org-1')
    expect(result.billedAccountUserId).toBe('owner-1')
    expect(result.reason).toContain('owners and admins')
    expect(mockGetOrganizationSubscription).not.toHaveBeenCalled()
    expect(mockGetHighestPrioritySubscription).not.toHaveBeenCalled()
  })
})

describe('getWorkspaceInvitePolicy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    setEnvFlags({ isBillingEnabled: true })
    mockGetOrganizationSubscription.mockResolvedValue(null)
    mockGetHighestPrioritySubscription.mockResolvedValue(null)
  })

  const baseState = {
    workspaceMode: WORKSPACE_MODE.PERSONAL,
    organizationId: null,
    billedAccountUserId: 'owner-1',
    ownerId: 'owner-1',
  } as const

  it('allows invites unconditionally when billing is disabled', async () => {
    setEnvFlags({ isBillingEnabled: false })

    const result = await getWorkspaceInvitePolicy(baseState)

    expect(result.allowed).toBe(true)
    expect(result.upgradeRequired).toBe(false)
    expect(mockGetHighestPrioritySubscription).not.toHaveBeenCalled()
  })

  it('blocks free personal workspaces with an upgrade prompt', async () => {
    const result = await getWorkspaceInvitePolicy(baseState)

    expect(result.allowed).toBe(false)
    expect(result.upgradeRequired).toBe(true)
    expect(result.reason).toBe(UPGRADE_TO_INVITE_REASON)
  })

  it('allows pro personal workspaces and defers the team upgrade to acceptance', async () => {
    mockGetHighestPrioritySubscription.mockResolvedValueOnce({
      id: 'sub-1',
      plan: 'pro_6000',
      status: 'active',
    })

    const result = await getWorkspaceInvitePolicy(baseState)

    expect(result.allowed).toBe(true)
    expect(result.requiresSeat).toBe(false)
    expect(result.upgradeRequired).toBe(false)
  })

  it('allows team org workspaces without an invite-time seat gate', async () => {
    mockGetOrganizationSubscription.mockResolvedValueOnce({
      id: 'sub-1',
      plan: 'team_6000',
      status: 'active',
    })

    const result = await getWorkspaceInvitePolicy({
      ...baseState,
      workspaceMode: WORKSPACE_MODE.ORGANIZATION,
      organizationId: 'org-1',
    })

    expect(result.allowed).toBe(true)
    expect(result.requiresSeat).toBe(false)
    expect(result.organizationId).toBe('org-1')
  })

  it('keeps the fixed-seat gate for enterprise org workspaces', async () => {
    mockGetOrganizationSubscription.mockResolvedValueOnce({
      id: 'sub-1',
      plan: 'enterprise',
      status: 'active',
    })

    const result = await getWorkspaceInvitePolicy({
      ...baseState,
      workspaceMode: WORKSPACE_MODE.ORGANIZATION,
      organizationId: 'org-1',
    })

    expect(result.allowed).toBe(true)
    expect(result.requiresSeat).toBe(true)
  })

  it('blocks org workspaces whose organization has no usable subscription', async () => {
    mockGetOrganizationSubscription.mockResolvedValueOnce(null)

    const result = await getWorkspaceInvitePolicy({
      ...baseState,
      workspaceMode: WORKSPACE_MODE.ORGANIZATION,
      organizationId: 'org-1',
    })

    expect(result.allowed).toBe(false)
    expect(result.upgradeRequired).toBe(true)
  })

  it('blocks org workspaces without an organization id', async () => {
    const result = await getWorkspaceInvitePolicy({
      ...baseState,
      workspaceMode: WORKSPACE_MODE.ORGANIZATION,
    })

    expect(result.allowed).toBe(false)
    expect(result.upgradeRequired).toBe(true)
  })

  it('allows grandfathered workspaces when the billed user has a team plan', async () => {
    mockGetHighestPrioritySubscription.mockResolvedValueOnce({
      id: 'sub-1',
      plan: 'team_6000',
      status: 'active',
    })

    const result = await getWorkspaceInvitePolicy({
      ...baseState,
      workspaceMode: WORKSPACE_MODE.GRANDFATHERED_SHARED,
    })

    expect(result.allowed).toBe(true)
    expect(result.upgradeRequired).toBe(false)
    expect(mockGetHighestPrioritySubscription.mock.calls[0]?.[0]).toBe('owner-1')
  })

  it('allows grandfathered workspaces when the billed user has a pro plan', async () => {
    mockGetHighestPrioritySubscription.mockResolvedValueOnce({
      id: 'sub-1',
      plan: 'pro_6000',
      status: 'active',
    })

    const result = await getWorkspaceInvitePolicy({
      ...baseState,
      workspaceMode: WORKSPACE_MODE.GRANDFATHERED_SHARED,
    })

    expect(result.allowed).toBe(true)
    expect(result.upgradeRequired).toBe(false)
  })

  it('blocks grandfathered workspaces when the billed user is on a free plan', async () => {
    mockGetHighestPrioritySubscription.mockResolvedValueOnce(null)

    const result = await getWorkspaceInvitePolicy({
      ...baseState,
      workspaceMode: WORKSPACE_MODE.GRANDFATHERED_SHARED,
    })

    expect(result.allowed).toBe(false)
    expect(result.upgradeRequired).toBe(true)
    expect(result.reason).toBe(UPGRADE_TO_INVITE_REASON)
  })
})
