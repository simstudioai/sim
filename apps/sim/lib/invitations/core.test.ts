import {
  auditMock,
  dbChainMock,
  dbChainMockFns,
  resetDbChainMock,
  resetEnvFlagsMock,
  setEnvFlags,
} from '@sim/testing'
import {
  billingSubscriptionMock,
  billingSubscriptionMockFns,
} from '@sim/testing/mocks/billing-subscription.mock'
import { billingUsageMock, billingUsageMockFns } from '@sim/testing/mocks/billing-usage.mock'
import {
  credentialsEnvironmentMock,
  credentialsEnvironmentMockFns,
} from '@sim/testing/mocks/credentials-environment.mock'
import {
  organizationMembershipMock,
  organizationMembershipMockFns,
} from '@sim/testing/mocks/organization-membership.mock'
import {
  organizationSeatsMock,
  organizationSeatsMockFns,
} from '@sim/testing/mocks/organization-seats.mock'
import { permissionsMock, permissionsMockFns } from '@sim/testing/mocks/permissions.mock'
import {
  workspacesPolicyMock,
  workspacesPolicyMockFns,
} from '@sim/testing/mocks/workspaces-policy.mock'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockEnsureTeamOrganizationForAcceptance,
  mockSetActiveOrganizationForCurrentSession,
  mockAttachOwnedWorkspacesToOrganizationTx,
} = vi.hoisted(() => ({
  mockEnsureTeamOrganizationForAcceptance: vi.fn(),
  mockSetActiveOrganizationForCurrentSession: vi.fn(),
  mockAttachOwnedWorkspacesToOrganizationTx: vi.fn(),
}))

vi.mock('@/lib/billing/organizations/membership', () => organizationMembershipMock)

vi.mock('@/lib/billing/organizations/provision-seat', () => ({
  ensureTeamOrganizationForAcceptance: mockEnsureTeamOrganizationForAcceptance,
}))

vi.mock('@/lib/billing/organizations/seats', () => organizationSeatsMock)

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

vi.mock('@/lib/auth/active-organization', () => ({
  setActiveOrganizationForCurrentSession: mockSetActiveOrganizationForCurrentSession,
}))

vi.mock('@/lib/billing/core/subscription', () => billingSubscriptionMock)
billingSubscriptionMockFns.mockIsWorkspaceOnEnterprisePlan.mockResolvedValue(true)

vi.mock('@/lib/billing/core/usage', () => billingUsageMock)

vi.mock('@/lib/credentials/environment', () => credentialsEnvironmentMock)

vi.mock('@/lib/workspaces/organization-workspaces', () => ({
  attachOwnedWorkspacesToOrganizationTx: mockAttachOwnedWorkspacesToOrganizationTx,
  ownedAttachableWorkspacesWhere: vi.fn(),
}))

vi.mock('@/lib/workspaces/policy', () => workspacesPolicyMock)

vi.mock('@sim/audit', () => auditMock)

import {
  acceptInvitation,
  rejectInvitation,
  resolveInvitationAdmissionOrganizationId,
  revokeInvitationAsAdmin,
  updateInvitation,
} from '@/lib/invitations/core'

const { mockEnsureUserInOrganizationTx: mockEnsureUserInOrganization, mockGetUserOrganization } =
  organizationMembershipMockFns
const { mockGetWorkspaceWithOwner } = permissionsMockFns
const mockReconcileOrganizationSeats = organizationSeatsMockFns.mockReconcileOrganizationSeats
const mockSyncUsageLimitsFromSubscription = billingUsageMockFns.mockSyncUsageLimitsFromSubscription
const mockSyncWorkspaceEnvCredentials =
  credentialsEnvironmentMockFns.mockSyncWorkspaceEnvCredentials
/** Externals must be on a paid plan; invite-time enforces it, accept re-checks. */
const mockGetInvitePlanCategoryForUser = workspacesPolicyMockFns.mockGetInvitePlanCategoryForUser
mockGetInvitePlanCategoryForUser.mockResolvedValue('pro')

function queueWhereResponses(responses: unknown[][]) {
  const queue = [...responses]
  dbChainMockFns.where.mockImplementation(() => {
    const result = queue.shift() ?? []
    const thenable = Promise.resolve(result) as Promise<unknown[]> & {
      limit: ReturnType<typeof vi.fn>
      orderBy: ReturnType<typeof vi.fn>
      returning: ReturnType<typeof vi.fn>
      groupBy: ReturnType<typeof vi.fn>
      for: ReturnType<typeof vi.fn>
    }
    thenable.limit = vi.fn(() => Promise.resolve(result))
    thenable.orderBy = vi.fn(() => Promise.resolve(result))
    thenable.returning = vi.fn(() => Promise.resolve(result))
    thenable.groupBy = vi.fn(() => Promise.resolve(result))
    thenable.for = vi.fn((lockMode: string) => {
      dbChainMockFns.for(lockMode)
      return thenable
    })
    return thenable as ReturnType<typeof dbChainMockFns.where>
  })
}

afterAll(resetEnvFlagsMock)

describe('acceptInvitation', () => {
  beforeEach(() => {
    resetDbChainMock()
    setEnvFlags({ isBillingEnabled: true })
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
    mockAttachOwnedWorkspacesToOrganizationTx.mockResolvedValue({
      attachedWorkspaceIds: [],
      addedMemberIds: [],
      skippedMembers: [],
      usageLimitUserIds: [],
    })
  })

  it('rejects when the disclosed join outcome no longer matches (empty sweep set)', async () => {
    /**
     * The workspace-id token cannot express this: the invitee owns nothing, so
     * both a no-join and a will-join preview disclose []. Without the explicit
     * membership half of the token, leaving another org between preview and
     * accept would silently create a seat-consuming membership the screen said
     * would stay external.
     */
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
      userId: 'invitee-user',
      userEmail: 'invitee@example.com',
      invitationId: 'inv-1',
      token: 'tok-1',
      actorName: 'Invitee',
      // The screen promised "you will not join" — acceptance resolves to a join.
      disclosedWorkspaceIds: [],
      disclosedOutcome: 'external' as const,
      request: new Request('http://localhost/api/invitations/inv-1/accept'),
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.kind).toBe('disclosure-outdated')
    }
    expect(mockEnsureUserInOrganization).not.toHaveBeenCalled()
  })

  it('accepts a forced-external invitation from a free invitee already in another org', async () => {
    /**
     * Cross-org invitees are stamped external regardless of the inviter's
     * choice, so invite time never applies the paid-plan gate to them. Accept
     * must not apply it either, or a Member invite would send cleanly and then
     * be unacceptable.
     */
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
      actorName: 'External User',
      request: new Request('http://localhost/api/invitations/inv-1/accept'),
    })

    expect(result.success).toBe(true)
    expect(mockEnsureUserInOrganization).not.toHaveBeenCalled()
    /** The plan requirement must not even be evaluated for imposed externality. */
    expect(mockGetInvitePlanCategoryForUser).not.toHaveBeenCalled()
  })

  it('rejects an external invitation when the invitee is no longer on a paid plan', async () => {
    mockGetInvitePlanCategoryForUser.mockResolvedValueOnce('free')
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
      actorName: 'External User',
      request: new Request('http://localhost/api/invitations/inv-1/accept'),
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.kind).toBe('external-requires-paid-plan')
    }
    expect(mockEnsureUserInOrganization).not.toHaveBeenCalled()
  })

  it('accepts a personal-workspace invite on a billing-disabled deployment', async () => {
    /**
     * With billing off and no organization on the workspace there is nothing to
     * provision and nothing to join, so the preview reports `external`. The
     * consent guard must agree: `shouldJoinOrganization` is still true at that
     * point (it is only cleared much later), so deriving the predicate from it
     * alone rejected every self-hosted personal invite as `disclosure-outdated`,
     * with a retry that rendered the same preview.
     */
    setEnvFlags({ isBillingEnabled: false })
    mockGetWorkspaceWithOwner.mockResolvedValue({
      id: 'workspace-1',
      name: 'Workspace',
      ownerId: 'owner-1',
      organizationId: null,
      workspaceMode: 'personal',
      billedAccountUserId: 'owner-1',
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
      [],
      [{ name: 'Owner', email: 'owner@example.com' }],
      [],
      [],
      [{ variables: {} }],
    ])

    const result = await acceptInvitation({
      userId: 'invitee-user',
      userEmail: 'invitee@example.com',
      invitationId: 'inv-1',
      token: 'tok-1',
      disclosedWorkspaceIds: [],
      disclosedOutcome: 'external',
      request: new Request('http://localhost/api/invitations/inv-1/accept'),
    })

    expect(result.success ? 'ok' : result.kind).toBe('ok')
    expect(mockEnsureUserInOrganization).not.toHaveBeenCalled()
  })

  it.each([
    {
      kind: 'organization' as const,
      grants: [
        {
          id: 'grant-1',
          workspaceId: 'workspace-1',
          permission: 'read' as const,
          workspaceName: 'Workspace',
        },
      ],
    },
    { kind: 'workspace' as const, grants: [] },
  ])(
    'keeps a cross-org $kind invitation pending when it is not a workspace grant invite',
    async ({ kind, grants }) => {
      mockGetUserOrganization.mockResolvedValueOnce({
        organizationId: 'org-2',
        role: 'member',
        memberId: 'member-2',
      })

      queueWhereResponses([
        [
          {
            id: 'inv-cross-org',
            kind,
            email: 'invitee@example.com',
            organizationId: 'org-1',
            membershipIntent: 'internal',
            inviterId: 'inviter-1',
            role: 'member',
            status: 'pending',
            token: 'tok-cross-org',
            expiresAt: new Date(Date.now() + 60_000),
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
        grants,
        [{ name: 'Acme' }],
        [{ name: 'Inviter', email: 'inviter@example.com' }],
        [],
        [],
        [{ variables: {} }],
      ])

      const result = await acceptInvitation({
        userId: 'invitee-user',
        userEmail: 'invitee@example.com',
        invitationId: 'inv-cross-org',
        token: 'tok-cross-org',
      })

      expect(result).toEqual({ success: false, kind: 'already-in-organization' })
      expect(dbChainMockFns.set).not.toHaveBeenCalled()
      expect(dbChainMockFns.values).not.toHaveBeenCalled()
      expect(mockEnsureTeamOrganizationForAcceptance).not.toHaveBeenCalled()
      expect(mockEnsureUserInOrganization).not.toHaveBeenCalled()
      expect(mockSetActiveOrganizationForCurrentSession).not.toHaveBeenCalled()
      expect(auditMock.recordAudit).not.toHaveBeenCalled()
    }
  )

  it('still sweeps when the same transaction auto-joined the invitee', async () => {
    mockGetWorkspaceWithOwner.mockResolvedValue({
      id: 'workspace-1',
      name: 'Workspace',
      ownerId: 'owner-1',
      organizationId: 'org-1',
      workspaceMode: 'organization',
      billedAccountUserId: 'owner-1',
    })
    /**
     * No membership before acceptance, but ensureUserInOrganizationTx reports
     * alreadyMember — i.e. the Pro→Team conversion's keep-external attach
     * joined this collaborator moments earlier in the same transaction. The
     * sweep and the seat reconcile must still run.
     */
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
    mockAttachOwnedWorkspacesToOrganizationTx.mockResolvedValueOnce({
      attachedWorkspaceIds: ['joiner-ws-1'],
      addedMemberIds: [],
      skippedMembers: [],
      usageLimitUserIds: [],
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
      // Invitee-owned personal workspaces for the acceptance lock plan.
      [{ id: 'joiner-ws-1' }],
      // Post-join owned-set re-check under the billing-identity lock.
      [{ id: 'joiner-ws-1' }],
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
    expect(mockAttachOwnedWorkspacesToOrganizationTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ ownerUserId: 'invitee-user', workspaceIds: ['joiner-ws-1'] })
    )
    expect(mockReconcileOrganizationSeats).toHaveBeenCalled()
  })

  it('surfaces the real cause, not a consent mismatch, when the disclosure said blocked', async () => {
    /**
     * The preview reports `blocked` for dead grants, so the screen promised
     * nothing. Acceptance must return the real cause (`workspace-not-found`)
     * rather than `disclosure-outdated` — the latter renders the same preview on
     * retry, so the invitee would loop with no explanation.
     */
    mockGetWorkspaceWithOwner.mockResolvedValue({
      id: 'workspace-1',
      name: 'Workspace',
      ownerId: 'owner-1',
      organizationId: 'org-1',
      workspaceMode: 'organization',
      billedAccountUserId: 'owner-1',
    })
    queueWhereResponses([
      [
        {
          id: 'inv-1',
          kind: 'organization',
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
      [],
      [],
    ])

    const result = await acceptInvitation({
      userId: 'invitee-user',
      userEmail: 'invitee@example.com',
      invitationId: 'inv-1',
      token: 'tok-1',
      disclosedWorkspaceIds: [],
      disclosedOutcome: 'blocked',
    })

    expect(result).toEqual({ success: false, kind: 'workspace-not-found' })
    expect(mockEnsureUserInOrganization).not.toHaveBeenCalled()
  })

  it('rejects a will-join disclosure when acceptance downgrades to external', async () => {
    mockGetWorkspaceWithOwner.mockResolvedValue({
      id: 'workspace-1',
      name: 'Workspace',
      ownerId: 'owner-1',
      organizationId: 'org-1',
      workspaceMode: 'organization',
      billedAccountUserId: 'owner-1',
    })
    // Invitee joined a different organization after the preview rendered.
    mockGetUserOrganization.mockImplementation(async (userId: string) =>
      userId === 'invitee-user'
        ? { organizationId: 'org-2', role: 'member', memberId: 'member-2' }
        : null
    )

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
      // Invitee-owned personal workspaces for the acceptance lock plan.
      [{ id: 'joiner-ws-1' }],
    ])

    const result = await acceptInvitation({
      userId: 'invitee-user',
      userEmail: 'invitee@example.com',
      invitationId: 'inv-1',
      token: 'tok-1',
      // The accept screen promised a membership migration of joiner-ws-1.
      disclosedWorkspaceIds: ['joiner-ws-1'],
    })

    expect(result).toEqual({ success: false, kind: 'disclosure-outdated' })
    expect(dbChainMockFns.values).not.toHaveBeenCalled()
    expect(auditMock.recordAudit).not.toHaveBeenCalled()
  })

  it('rolls back acceptance when the sweep set differs from the disclosed set', async () => {
    mockGetWorkspaceWithOwner.mockResolvedValue({
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
      // Invitee-owned personal workspaces for the acceptance lock plan.
      [{ id: 'joiner-ws-1' }],
      // Post-join owned-set re-check under the billing-identity lock.
      [{ id: 'joiner-ws-1' }],
    ])

    const result = await acceptInvitation({
      userId: 'invitee-user',
      userEmail: 'invitee@example.com',
      invitationId: 'inv-1',
      token: 'tok-1',
      // The accept screen rendered before joiner-ws-1 existed.
      disclosedWorkspaceIds: [],
    })

    expect(result).toEqual({ success: false, kind: 'disclosure-outdated' })
    expect(mockAttachOwnedWorkspacesToOrganizationTx).not.toHaveBeenCalled()
    expect(auditMock.recordAudit).not.toHaveBeenCalled()
  })

  it('rolls back acceptance when the owned-workspace set changes concurrently', async () => {
    mockGetWorkspaceWithOwner.mockResolvedValue({
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
      // Invitee-owned personal workspaces for the acceptance lock plan.
      [{ id: 'joiner-ws-1' }],
      // Post-join re-check sees a workspace created after the lock plan.
      [{ id: 'joiner-ws-1' }, { id: 'joiner-ws-2' }],
    ])

    const result = await acceptInvitation({
      userId: 'invitee-user',
      userEmail: 'invitee@example.com',
      invitationId: 'inv-1',
      token: 'tok-1',
    })

    expect(result).toEqual({
      success: false,
      kind: 'server-error',
      message: 'Your workspaces changed while accepting — please try again.',
    })
    expect(mockAttachOwnedWorkspacesToOrganizationTx).not.toHaveBeenCalled()
    expect(auditMock.recordAudit).not.toHaveBeenCalled()
  })

  it('grants external access without joining when the workspace entered an org after the invite was sent', async () => {
    mockGetWorkspaceWithOwner.mockResolvedValue({
      id: 'workspace-1',
      name: 'Workspace',
      ownerId: 'owner-1',
      organizationId: 'org-1',
      workspaceMode: 'organization',
      billedAccountUserId: 'org-owner',
    })
    // Inviter is a plain member of org-1 (their own join attached this
    // workspace), so the stale-stamped invite must not escalate to membership.
    mockGetUserOrganization.mockImplementation(async (userId: string) =>
      userId === 'inviter-1'
        ? { organizationId: 'org-1', role: 'member', memberId: 'member-inviter' }
        : null
    )

    queueWhereResponses([
      [
        {
          id: 'inv-1',
          kind: 'workspace',
          email: 'invitee@example.com',
          organizationId: null,
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
          permission: 'write',
          workspaceName: 'Workspace',
        },
      ],
      [{ name: 'Inviter', email: 'inviter@example.com' }],
      // Invitee-owned personal workspaces for the acceptance lock plan.
      [],
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
    expect(mockEnsureTeamOrganizationForAcceptance).not.toHaveBeenCalled()
    expect(mockEnsureUserInOrganization).not.toHaveBeenCalled()
    expect(mockAttachOwnedWorkspacesToOrganizationTx).not.toHaveBeenCalled()
    expect(mockSetActiveOrganizationForCurrentSession).not.toHaveBeenCalled()
  })

  it('lets a pre-existing member accept a no-join disclosure without looping', async () => {
    /**
     * The preview reports no-join for someone already in the target
     * organization — nothing changes for them — while the invitation's intent
     * stays internal, so `shouldJoinOrganization` remains true. Comparing the
     * disclosure against that raw flag rejected every such acceptance as
     * `disclosure-outdated`, and the retry re-rendered the same preview, so the
     * invitation could never be accepted. The guard compares against whether a
     * NEW membership is created instead.
     */
    mockGetWorkspaceWithOwner.mockResolvedValue({
      id: 'workspace-1',
      name: 'Workspace',
      ownerId: 'owner-1',
      organizationId: 'org-1',
      workspaceMode: 'organization',
      billedAccountUserId: 'owner-1',
    })
    mockGetUserOrganization.mockResolvedValue({
      organizationId: 'org-1',
      role: 'member',
      memberId: 'member-1',
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
      [],
      [{ id: 'member-1' }],
    ])

    const result = await acceptInvitation({
      userId: 'invitee-user',
      userEmail: 'invitee@example.com',
      invitationId: 'inv-1',
      token: 'tok-1',
      disclosedWorkspaceIds: [],
      disclosedOutcome: 'external' as const,
    })

    expect(result.success ? 'ok' : result.kind).toBe('ok')
    if (result.success) {
      expect(result.membershipAlreadyExists).toBe(true)
    }
  })

  it('does not reconcile seats for an Enterprise organization (fixed seats)', async () => {
    mockGetWorkspaceWithOwner.mockResolvedValue({
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
      // Invitee-owned personal workspaces for the acceptance lock plan.
      [],
      // Post-join owned-set re-check under the billing-identity lock.
      [],
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
      expect.anything(),
      expect.objectContaining({ organizationId: 'org-1', skipSeatValidation: false })
    )
    expect(mockReconcileOrganizationSeats).not.toHaveBeenCalled()
  })

  it('does not run post-commit effects when the invitation transaction fails to commit', async () => {
    mockGetWorkspaceWithOwner.mockResolvedValue({
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
      postCommitEffects: {
        planConversions: [
          {
            organizationId: 'org-1',
            actorId: 'owner-1',
            fromPlan: 'pro_6000',
            toPlan: 'team_6000',
          },
        ],
        usageLimitUserIds: ['collaborator-1'],
      },
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
      // Invitee-owned personal workspaces for the acceptance lock plan.
      [],
      // Post-join owned-set re-check under the billing-identity lock.
      [],
      [{ id: 'member-1' }],
    ])

    dbChainMockFns.transaction.mockImplementationOnce(async (callback) => {
      await callback(dbChainMock.db)
      throw new Error('commit failed')
    })

    await expect(
      acceptInvitation({
        userId: 'invitee-user',
        userEmail: 'invitee@example.com',
        invitationId: 'inv-1',
        token: 'tok-1',
      })
    ).resolves.toEqual({ success: false, kind: 'server-error' })

    expect(auditMock.recordAudit).not.toHaveBeenCalled()
    expect(mockReconcileOrganizationSeats).not.toHaveBeenCalled()
    expect(mockSetActiveOrganizationForCurrentSession).not.toHaveBeenCalled()
    expect(mockSyncWorkspaceEnvCredentials).not.toHaveBeenCalled()
    expect(mockSyncUsageLimitsFromSubscription).not.toHaveBeenCalled()
    expect(mockEnsureTeamOrganizationForAcceptance).toHaveBeenCalledWith(
      expect.objectContaining({ executor: dbChainMock.db })
    )
  })

  it('blocks acceptance with upgrade-required when the owner has no usable plan', async () => {
    mockGetWorkspaceWithOwner.mockResolvedValue({
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
    mockGetWorkspaceWithOwner.mockResolvedValue({
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

function invitationHydrationRows(params?: {
  status?: 'pending' | 'accepted'
  organizationId?: string
}) {
  const organizationId = params?.organizationId ?? 'org-1'
  return [
    [
      {
        id: 'inv-1',
        kind: 'organization',
        email: 'invitee@example.com',
        organizationId,
        membershipIntent: 'internal',
        inviterId: 'owner-1',
        role: 'member',
        status: params?.status ?? 'pending',
        token: 'tok-1',
        expiresAt: new Date(Date.now() + 60_000),
        createdAt: new Date(),
        updatedAt: new Date('2026-07-30T12:00:00.000Z'),
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
  ]
}

describe('locked invitation mutations', () => {
  beforeEach(() => {
    resetDbChainMock()
    mockGetWorkspaceWithOwner.mockResolvedValue({
      id: 'workspace-1',
      name: 'Workspace',
      ownerId: 'owner-1',
      organizationId: null,
      workspaceMode: 'personal',
      billedAccountUserId: 'owner-1',
    })
  })

  it('reject cannot overwrite an invitation accepted before its protected re-read', async () => {
    queueWhereResponses([
      ...invitationHydrationRows({ status: 'pending' }),
      ...invitationHydrationRows({ status: 'accepted' }),
    ])

    const result = await rejectInvitation({
      userId: 'invitee-user',
      userEmail: 'invitee@example.com',
      invitationId: 'inv-1',
      token: 'tok-1',
    })

    expect(result).toEqual({ success: false, kind: 'already-processed' })
    expect(dbChainMockFns.set).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: 'rejected' })
    )
  })

  it('PATCH locks its workspace before row claim and authorizes the protected state', async () => {
    queueWhereResponses([
      ...invitationHydrationRows({ organizationId: 'org-old' }),
      ...invitationHydrationRows({ organizationId: 'org-new' }),
      [{ id: 'permission-1', permissionType: 'admin' }],
      [{ id: 'inv-1' }],
      [],
    ])

    const result = await updateInvitation({
      actorId: 'admin-1',
      invitationId: 'inv-1',
      grants: [{ workspaceId: 'workspace-1', permission: 'admin' }],
    })

    expect(result.success).toBe(true)
    const executedSql = dbChainMockFns.execute.mock.calls.map(([query]) =>
      ((query as { strings?: readonly string[] }).strings ?? []).join('')
    )
    const invitationLockIndex = executedSql.findIndex((sqlText) =>
      sqlText.includes('pg_advisory_xact_lock')
    )
    const workspaceLockIndex = executedSql.findIndex(
      (sqlText, index) => index > invitationLockIndex && sqlText.includes('pg_advisory_xact_lock')
    )
    const rowLockIndex = executedSql.findIndex((sqlText) => sqlText.includes('for update'))
    expect(invitationLockIndex).toBeGreaterThanOrEqual(0)
    expect(workspaceLockIndex).toBeGreaterThan(invitationLockIndex)
    expect(rowLockIndex).toBeGreaterThan(workspaceLockIndex)
    expect(dbChainMockFns.for).toHaveBeenCalledWith('update')
    expect(dbChainMockFns.for.mock.invocationCallOrder[0]).toBeLessThan(
      dbChainMockFns.set.mock.invocationCallOrder[0]
    )
  })

  it('DELETE refuses delegated organization scope after the protected re-read changes', async () => {
    queueWhereResponses([
      ...invitationHydrationRows({ organizationId: 'org-old' }),
      ...invitationHydrationRows({ organizationId: 'org-new' }),
    ])
    await expect(
      revokeInvitationAsAdmin({
        actorId: 'admin-1',
        invitationId: 'inv-1',
        organizationId: 'org-old',
      })
    ).resolves.toEqual({ success: false, kind: 'not-found' })
    expect(dbChainMockFns.set).not.toHaveBeenCalled()
  })

  it.each([undefined, 'workspace-1'])(
    'DELETE refuses expiry while waiting for authority locks (scope %s)',
    async (workspaceId) => {
      const now = Date.now()
      const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
      try {
        queueWhereResponses([
          ...invitationHydrationRows(),
          ...invitationHydrationRows(),
          [{ id: 'member-1', role: 'admin' }],
        ])
        dbChainMockFns.for.mockImplementationOnce(() => {
          clock.mockReturnValue(now + 120_000)
          return dbChainMock
        })
        await expect(
          revokeInvitationAsAdmin({
            actorId: 'admin-1',
            invitationId: 'inv-1',
            workspaceId,
          })
        ).resolves.toEqual({ success: false, kind: 'not-pending' })
        expect(dbChainMockFns.set).not.toHaveBeenCalled()
        expect(dbChainMockFns.delete).not.toHaveBeenCalled()
      } finally {
        clock.mockRestore()
      }
    }
  )

  it('PATCH role update observes an organization-admin demotion before mutating', async () => {
    queueWhereResponses([
      ...invitationHydrationRows(),
      ...invitationHydrationRows(),
      [{ id: 'member-1', role: 'member' }],
    ])

    await expect(
      updateInvitation({
        actorId: 'admin-1',
        invitationId: 'inv-1',
        role: 'admin',
      })
    ).resolves.toEqual({ success: false, kind: 'organization-forbidden' })
    expect(dbChainMockFns.for).toHaveBeenCalledWith('update')
    expect(dbChainMockFns.set).not.toHaveBeenCalled()
  })
})

/**
 * What an invitation ADMITS TO, which is not its `kind`. The send-capability
 * gates read this so they cannot let an invitation carry a member into an
 * organization whose group withholds invitations, and so they cannot demand an
 * organization's permission for an invitation that joins nobody to it.
 */
describe('resolveInvitationAdmissionOrganizationId', () => {
  const invitation = {
    id: 'invitation-1',
    kind: 'workspace' as const,
    email: 'invitee@example.com',
    organizationId: 'organization-1',
    membershipIntent: 'internal' as const,
    inviterId: 'inviter-1',
    role: 'member',
    status: 'pending' as const,
    token: 'token-1',
    expiresAt: new Date('2026-12-01T00:00:00.000Z'),
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    grants: [
      {
        id: 'grant-1',
        workspaceId: 'workspace-1',
        permission: 'read' as const,
        workspaceName: 'Workspace',
      },
    ],
    organizationName: null,
    inviterName: null,
    inviterEmail: null,
  }

  beforeEach(() => {
    resetDbChainMock()
    mockGetUserOrganization.mockResolvedValue(null)
    mockGetWorkspaceWithOwner.mockResolvedValue({
      id: 'workspace-1',
      organizationId: 'organization-1',
      billedAccountUserId: 'owner-1',
    })
  })

  it('names the organization a granted workspace belongs to, for a workspace invitation', async () => {
    expect(await resolveInvitationAdmissionOrganizationId(invitation)).toBe('organization-1')
  })

  /**
   * The workspace moved after the invite went out. Acceptance escalates into the
   * new organization only when the inviter currently holds admin standing there,
   * so the gate has to ask the same question of the same organization.
   */
  it('follows a moved workspace into its live organization when the inviter may escalate', async () => {
    mockGetWorkspaceWithOwner.mockResolvedValue({
      id: 'workspace-1',
      organizationId: 'organization-2',
      billedAccountUserId: 'owner-1',
    })
    mockGetUserOrganization.mockResolvedValue({
      organizationId: 'organization-2',
      role: 'admin',
    })

    expect(await resolveInvitationAdmissionOrganizationId(invitation)).toBe('organization-2')
  })

  it('names nobody when the escalation acceptance would refuse is the only join on offer', async () => {
    mockGetWorkspaceWithOwner.mockResolvedValue({
      id: 'workspace-1',
      organizationId: 'organization-2',
      billedAccountUserId: 'owner-1',
    })
    mockGetUserOrganization.mockResolvedValue({
      organizationId: 'organization-2',
      role: 'member',
    })

    expect(await resolveInvitationAdmissionOrganizationId(invitation)).toBeNull()
  })

  /**
   * An organization invitation joins its STAMPED organization whatever its
   * granted workspaces do — the join target is never re-derived from a workspace
   * whose organization can change after send.
   */
  it('keeps an organization invitation on its stamped organization', async () => {
    mockGetWorkspaceWithOwner.mockResolvedValue({
      id: 'workspace-1',
      organizationId: 'organization-2',
      billedAccountUserId: 'owner-1',
    })

    expect(
      await resolveInvitationAdmissionOrganizationId({ ...invitation, kind: 'organization' })
    ).toBe('organization-1')
  })
})
