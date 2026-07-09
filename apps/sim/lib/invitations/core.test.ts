/**
 * @vitest-environment node
 */
import { auditMock, dbChainMock, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockEnsureUserInOrganization,
  mockGetUserOrganization,
  mockAcquireOrgMembershipLock,
  mockEnsureTeamOrganizationForAcceptance,
  mockReconcileOrganizationSeats,
  mockGetWorkspaceWithOwner,
  mockSetActiveOrganizationForCurrentSession,
  mockSyncUsageLimitsFromSubscription,
  mockSyncWorkspaceEnvCredentials,
  mockIsWorkspaceOnEnterprisePlan,
  mockFeatureFlags,
} = vi.hoisted(() => ({
  mockEnsureUserInOrganization: vi.fn(),
  mockGetUserOrganization: vi.fn(),
  mockAcquireOrgMembershipLock: vi.fn(),
  mockEnsureTeamOrganizationForAcceptance: vi.fn(),
  mockReconcileOrganizationSeats: vi.fn(),
  mockGetWorkspaceWithOwner: vi.fn(),
  mockSetActiveOrganizationForCurrentSession: vi.fn(),
  mockSyncUsageLimitsFromSubscription: vi.fn(),
  mockSyncWorkspaceEnvCredentials: vi.fn(),
  mockIsWorkspaceOnEnterprisePlan: vi.fn(async () => true),
  mockFeatureFlags: { isBillingEnabled: true },
}))

vi.mock('@sim/db', () => dbChainMock)

vi.mock('@/lib/billing/organizations/membership', () => ({
  ensureUserInOrganization: mockEnsureUserInOrganization,
  getUserOrganization: mockGetUserOrganization,
  acquireOrgMembershipLock: mockAcquireOrgMembershipLock,
}))

vi.mock('@/lib/billing/organizations/provision-seat', () => ({
  ensureTeamOrganizationForAcceptance: mockEnsureTeamOrganizationForAcceptance,
}))

vi.mock('@/lib/billing/organizations/seats', () => ({
  reconcileOrganizationSeats: mockReconcileOrganizationSeats,
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getWorkspaceWithOwner: mockGetWorkspaceWithOwner,
}))

vi.mock('@/lib/core/config/env-flags', () => ({
  get isBillingEnabled() {
    return mockFeatureFlags.isBillingEnabled
  },
}))

vi.mock('@/lib/auth/active-organization', () => ({
  setActiveOrganizationForCurrentSession: mockSetActiveOrganizationForCurrentSession,
}))

vi.mock('@/lib/billing/core/subscription', () => ({
  isWorkspaceOnEnterprisePlan: mockIsWorkspaceOnEnterprisePlan,
}))

vi.mock('@/lib/billing/core/usage', () => ({
  syncUsageLimitsFromSubscription: mockSyncUsageLimitsFromSubscription,
}))

vi.mock('@/lib/credentials/environment', () => ({
  syncWorkspaceEnvCredentials: mockSyncWorkspaceEnvCredentials,
}))

vi.mock('@sim/audit', () => auditMock)

import { acceptInvitation } from '@/lib/invitations/core'

function queueWhereResponses(responses: unknown[][]) {
  const queue = [...responses]
  dbChainMockFns.where.mockImplementation(() => {
    const result = queue.shift() ?? []
    const thenable = Promise.resolve(result) as Promise<unknown[]> & {
      limit: ReturnType<typeof vi.fn>
      orderBy: ReturnType<typeof vi.fn>
      returning: ReturnType<typeof vi.fn>
      groupBy: ReturnType<typeof vi.fn>
    }
    thenable.limit = vi.fn(() => Promise.resolve(result))
    thenable.orderBy = vi.fn(() => Promise.resolve(result))
    thenable.returning = vi.fn(() => Promise.resolve(result))
    thenable.groupBy = vi.fn(() => Promise.resolve(result))
    return thenable as ReturnType<typeof dbChainMockFns.where>
  })
}

describe('acceptInvitation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockFeatureFlags.isBillingEnabled = true
    mockGetUserOrganization.mockResolvedValue(null)
    mockGetWorkspaceWithOwner.mockResolvedValue(null)
    mockEnsureTeamOrganizationForAcceptance.mockResolvedValue({
      success: true,
      organizationId: 'org-1',
      fixedSeats: false,
    })
    mockReconcileOrganizationSeats.mockResolvedValue({
      changed: true,
      previousSeats: 1,
      seats: 2,
    })
    mockEnsureUserInOrganization.mockResolvedValue({
      success: true,
      alreadyMember: false,
      billingActions: { proUsageSnapshotted: false, proCancelledAtPeriodEnd: false },
    })
  })

  it('accepts external workspace invitations without joining the organization', async () => {
    queueWhereResponses([
      [
        {
          id: 'inv-1',
          kind: 'workspace',
          email: 'external@example.com',
          organizationId: 'org-1',
          membershipIntent: 'external',
          inviterId: 'inviter-1',
          role: 'member',
          status: 'pending',
          token: 'tok-1',
          expiresAt: new Date(Date.now() + 60_000),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      [
        {
          id: 'grant-1',
          workspaceId: 'workspace-1',
          permission: 'write',
          workspaceName: 'Workspace',
        },
      ],
      [{ name: 'Acme' }],
      [{ name: 'Inviter', email: 'inviter@example.com' }],
      [],
      [],
      [{ variables: {} }],
    ])

    const result = await acceptInvitation({
      userId: 'external-user',
      userEmail: 'external@example.com',
      invitationId: 'inv-1',
      token: 'tok-1',
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.acceptedWorkspaceIds).toEqual(['workspace-1'])
      expect(result.membershipAlreadyExists).toBe(false)
    }
    expect(mockEnsureTeamOrganizationForAcceptance).not.toHaveBeenCalled()
    expect(mockEnsureUserInOrganization).not.toHaveBeenCalled()
    expect(mockSetActiveOrganizationForCurrentSession).not.toHaveBeenCalled()
    expect(mockSyncUsageLimitsFromSubscription).not.toHaveBeenCalled()
    expect(dbChainMockFns.values).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'external-user',
        entityType: 'workspace',
        entityId: 'workspace-1',
        permissionType: 'write',
      })
    )
  })

  it('falls back to external access when an internal workspace invitee already joined another organization', async () => {
    mockGetUserOrganization.mockResolvedValueOnce({
      organizationId: 'org-2',
      role: 'member',
      memberId: 'member-2',
    })

    queueWhereResponses([
      [
        {
          id: 'inv-1',
          kind: 'workspace',
          email: 'invitee@example.com',
          organizationId: 'org-1',
          membershipIntent: 'internal',
          inviterId: 'inviter-1',
          role: 'member',
          status: 'pending',
          token: 'tok-1',
          expiresAt: new Date(Date.now() + 60_000),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      [
        {
          id: 'grant-1',
          workspaceId: 'workspace-1',
          permission: 'read',
          workspaceName: 'Workspace',
        },
      ],
      [{ name: 'Acme' }],
      [{ name: 'Inviter', email: 'inviter@example.com' }],
      [],
      [],
      [{ variables: {} }],
    ])

    const result = await acceptInvitation({
      userId: 'invitee-user',
      userEmail: 'invitee@example.com',
      invitationId: 'inv-1',
      token: 'tok-1',
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.invitation.membershipIntent).toBe('external')
      expect(result.acceptedWorkspaceIds).toEqual(['workspace-1'])
    }
    // The single-org pre-check short-circuits to external access without
    // provisioning a seat or attempting an organization join.
    expect(mockEnsureTeamOrganizationForAcceptance).not.toHaveBeenCalled()
    expect(mockEnsureUserInOrganization).not.toHaveBeenCalled()
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'accepted',
        membershipIntent: 'external',
      })
    )
    expect(dbChainMockFns.values).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'invitee-user',
        entityType: 'workspace',
        entityId: 'workspace-1',
        permissionType: 'read',
      })
    )
  })

  it('provisions a team seat and joins the org created from a Pro owner conversion', async () => {
    mockGetWorkspaceWithOwner.mockResolvedValueOnce({
      id: 'workspace-1',
      name: 'Workspace',
      ownerId: 'owner-1',
      organizationId: null,
      workspaceMode: 'personal',
      billedAccountUserId: 'owner-1',
    })
    mockEnsureTeamOrganizationForAcceptance.mockResolvedValueOnce({
      success: true,
      organizationId: 'org-new',
      fixedSeats: false,
    })

    queueWhereResponses([
      [
        {
          id: 'inv-1',
          kind: 'workspace',
          email: 'invitee@example.com',
          organizationId: null,
          membershipIntent: 'internal',
          inviterId: 'owner-1',
          role: 'member',
          status: 'pending',
          token: 'tok-1',
          expiresAt: new Date(Date.now() + 60_000),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      [
        {
          id: 'grant-1',
          workspaceId: 'workspace-1',
          permission: 'write',
          workspaceName: 'Workspace',
        },
      ],
      [{ name: 'Owner', email: 'owner@example.com' }],
      // Grant-txn membership re-check under the lock: member still present.
      [{ id: 'member-1' }],
    ])

    const result = await acceptInvitation({
      userId: 'invitee-user',
      userEmail: 'invitee@example.com',
      invitationId: 'inv-1',
      token: 'tok-1',
    })

    expect(result.success).toBe(true)
    expect(mockEnsureTeamOrganizationForAcceptance).toHaveBeenCalledWith({
      billingOwnerUserId: 'owner-1',
      workspaceOrganizationId: null,
    })
    expect(mockEnsureUserInOrganization).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'invitee-user',
        organizationId: 'org-new',
        acceptingInvitationId: 'inv-1',
        skipSeatValidation: true,
      })
    )
    // Seats grow to match the new member; the Stripe charge is deferred to the
    // seat-sync outbox.
    expect(mockReconcileOrganizationSeats).toHaveBeenCalledWith({
      organizationId: 'org-new',
      reason: 'member-accepted-invite',
      actorId: 'invitee-user',
    })
    expect(mockSetActiveOrganizationForCurrentSession).toHaveBeenCalledWith('org-new')
    expect(auditMock.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'invitee-user',
        action: auditMock.AuditAction.ORG_MEMBER_ADDED,
        resourceType: auditMock.AuditResourceType.ORGANIZATION,
        resourceId: 'org-new',
        metadata: expect.objectContaining({ invitationId: 'inv-1', memberRole: 'member' }),
      })
    )
  })

  it('does not record an ORG_MEMBER_ADDED audit for a user who is already a member', async () => {
    mockGetWorkspaceWithOwner.mockResolvedValueOnce({
      id: 'workspace-1',
      name: 'Workspace',
      ownerId: 'owner-1',
      organizationId: 'org-1',
      workspaceMode: 'organization',
      billedAccountUserId: 'owner-1',
    })
    mockEnsureTeamOrganizationForAcceptance.mockResolvedValueOnce({
      success: true,
      organizationId: 'org-1',
      fixedSeats: false,
    })
    mockEnsureUserInOrganization.mockResolvedValueOnce({
      success: true,
      alreadyMember: true,
      billingActions: { proUsageSnapshotted: false, proCancelledAtPeriodEnd: false },
    })

    queueWhereResponses([
      [
        {
          id: 'inv-1',
          kind: 'workspace',
          email: 'invitee@example.com',
          organizationId: 'org-1',
          membershipIntent: 'internal',
          inviterId: 'owner-1',
          role: 'member',
          status: 'pending',
          token: 'tok-1',
          expiresAt: new Date(Date.now() + 60_000),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      [
        {
          id: 'grant-1',
          workspaceId: 'workspace-1',
          permission: 'write',
          workspaceName: 'Workspace',
        },
      ],
      [{ name: 'Acme' }],
      [{ name: 'Owner', email: 'owner@example.com' }],
      [{ id: 'member-1' }],
    ])

    const result = await acceptInvitation({
      userId: 'invitee-user',
      userEmail: 'invitee@example.com',
      invitationId: 'inv-1',
      token: 'tok-1',
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.membershipAlreadyExists).toBe(true)
    }
    expect(auditMock.recordAudit).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: auditMock.AuditAction.ORG_MEMBER_ADDED })
    )
  })

  it('does not reconcile seats for an Enterprise organization (fixed seats)', async () => {
    mockGetWorkspaceWithOwner.mockResolvedValueOnce({
      id: 'workspace-1',
      name: 'Workspace',
      ownerId: 'owner-1',
      organizationId: 'org-1',
      workspaceMode: 'organization',
      billedAccountUserId: 'owner-1',
    })
    mockEnsureTeamOrganizationForAcceptance.mockResolvedValueOnce({
      success: true,
      organizationId: 'org-1',
      fixedSeats: true,
    })

    queueWhereResponses([
      [
        {
          id: 'inv-1',
          kind: 'workspace',
          email: 'invitee@example.com',
          organizationId: 'org-1',
          membershipIntent: 'internal',
          inviterId: 'owner-1',
          role: 'member',
          status: 'pending',
          token: 'tok-1',
          expiresAt: new Date(Date.now() + 60_000),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      [
        {
          id: 'grant-1',
          workspaceId: 'workspace-1',
          permission: 'write',
          workspaceName: 'Workspace',
        },
      ],
      [{ name: 'Acme' }],
      [{ name: 'Owner', email: 'owner@example.com' }],
      // Grant-txn membership re-check under the lock: member still present.
      [{ id: 'member-1' }],
    ])

    const result = await acceptInvitation({
      userId: 'invitee-user',
      userEmail: 'invitee@example.com',
      invitationId: 'inv-1',
      token: 'tok-1',
    })

    expect(result.success).toBe(true)
    expect(mockEnsureUserInOrganization).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org-1', skipSeatValidation: false })
    )
    expect(mockReconcileOrganizationSeats).not.toHaveBeenCalled()
  })

  it('blocks acceptance with upgrade-required when the owner has no usable plan', async () => {
    mockGetWorkspaceWithOwner.mockResolvedValueOnce({
      id: 'workspace-1',
      name: 'Workspace',
      ownerId: 'owner-1',
      organizationId: 'org-1',
      workspaceMode: 'organization',
      billedAccountUserId: 'owner-1',
    })
    mockEnsureTeamOrganizationForAcceptance.mockResolvedValueOnce({
      success: false,
      failureCode: 'upgrade-required',
    })

    queueWhereResponses([
      [
        {
          id: 'inv-1',
          kind: 'workspace',
          email: 'invitee@example.com',
          organizationId: 'org-1',
          membershipIntent: 'internal',
          inviterId: 'owner-1',
          role: 'member',
          status: 'pending',
          token: 'tok-1',
          expiresAt: new Date(Date.now() + 60_000),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      [
        {
          id: 'grant-1',
          workspaceId: 'workspace-1',
          permission: 'write',
          workspaceName: 'Workspace',
        },
      ],
      [{ name: 'Acme' }],
      [{ name: 'Owner', email: 'owner@example.com' }],
    ])

    const result = await acceptInvitation({
      userId: 'invitee-user',
      userEmail: 'invitee@example.com',
      invitationId: 'inv-1',
      token: 'tok-1',
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.kind).toBe('upgrade-required')
    }
    expect(mockEnsureUserInOrganization).not.toHaveBeenCalled()
    expect(mockReconcileOrganizationSeats).not.toHaveBeenCalled()
  })

  it('aborts when the org membership is revoked concurrently during the grant', async () => {
    mockGetWorkspaceWithOwner.mockResolvedValueOnce({
      id: 'workspace-1',
      name: 'Workspace',
      ownerId: 'owner-1',
      organizationId: 'org-1',
      workspaceMode: 'organization',
      billedAccountUserId: 'owner-1',
    })
    mockEnsureTeamOrganizationForAcceptance.mockResolvedValueOnce({
      success: true,
      organizationId: 'org-1',
      fixedSeats: false,
    })

    queueWhereResponses([
      [
        {
          id: 'inv-1',
          kind: 'workspace',
          email: 'invitee@example.com',
          organizationId: 'org-1',
          membershipIntent: 'internal',
          inviterId: 'owner-1',
          role: 'member',
          status: 'pending',
          token: 'tok-1',
          expiresAt: new Date(Date.now() + 60_000),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      [
        {
          id: 'grant-1',
          workspaceId: 'workspace-1',
          permission: 'write',
          workspaceName: 'Workspace',
        },
      ],
      [{ name: 'Acme' }],
      [{ name: 'Owner', email: 'owner@example.com' }],
      // Grant-txn membership re-check finds no member row (removed concurrently).
      [],
    ])

    const result = await acceptInvitation({
      userId: 'invitee-user',
      userEmail: 'invitee@example.com',
      invitationId: 'inv-1',
      token: 'tok-1',
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.kind).toBe('already-processed')
    }
    // Aborted before granting workspace access — no zombie permission write.
    expect(mockSetActiveOrganizationForCurrentSession).not.toHaveBeenCalled()
  })
})
