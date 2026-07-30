/**
 * @vitest-environment node
 */
import {
  auditMock,
  authMockFns,
  createMockRequest,
  permissionsMock,
  permissionsMockFns,
  posthogServerMock,
  queueTableRows,
  resetDbChainMock,
  resetEnvFlagsMock,
  schemaMock,
  setEnvFlags,
} from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetWorkspaceInvitePolicy,
  mockValidateInvitationsAllowed,
  mockValidateSeatAvailability,
  mockGetUserOrganization,
  mockCreatePendingInvitation,
  mockSendInvitationEmail,
  mockCancelPendingInvitation,
  mockRevertPendingInvitationGrants,
  mockFindPendingGrantWorkspaceIds,
  mockGetInvitePlanCategoryForUser,
} = vi.hoisted(() => ({
  mockGetWorkspaceInvitePolicy: vi.fn(),
  mockValidateInvitationsAllowed: vi.fn().mockResolvedValue(undefined),
  mockValidateSeatAvailability: vi.fn(),
  mockGetUserOrganization: vi.fn(),
  mockCreatePendingInvitation: vi.fn(),
  mockSendInvitationEmail: vi.fn(),
  mockCancelPendingInvitation: vi.fn(),
  mockRevertPendingInvitationGrants: vi.fn(),
  mockFindPendingGrantWorkspaceIds: vi.fn(),
  mockGetInvitePlanCategoryForUser: vi.fn(),
}))

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

vi.mock('@/lib/workspaces/policy', () => ({
  getWorkspaceInvitePolicy: mockGetWorkspaceInvitePolicy,
  getInvitePlanCategoryForUser: mockGetInvitePlanCategoryForUser,
  isOrganizationWorkspace: (ws: {
    workspaceMode?: string | null
    organizationId?: string | null
  }) => ws.workspaceMode === 'organization' && !!ws.organizationId,
}))

vi.mock('@/lib/billing/validation/seat-management', () => ({
  validateSeatAvailability: mockValidateSeatAvailability,
}))

vi.mock('@/lib/billing/organizations/membership', () => ({
  getUserOrganization: mockGetUserOrganization,
}))

vi.mock('@/lib/invitations/send', () => ({
  createPendingInvitation: mockCreatePendingInvitation,
  sendInvitationEmail: mockSendInvitationEmail,
  cancelPendingInvitation: mockCancelPendingInvitation,
  revertPendingInvitationGrants: mockRevertPendingInvitationGrants,
  findPendingGrantWorkspaceIds: mockFindPendingGrantWorkspaceIds,
}))

vi.mock('@/lib/invitations/core', () => ({
  normalizeEmail: (email: string) => email.trim().toLowerCase(),
  listInvitationsForWorkspaces: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/ee/access-control/utils/permission-check', () => ({
  validateInvitationsAllowed: mockValidateInvitationsAllowed,
  InvitationsNotAllowedError: class InvitationsNotAllowedError extends Error {},
}))

vi.mock('@sim/audit', () => auditMock)

vi.mock('@/lib/posthog/server', () => posthogServerMock)

vi.mock('@/lib/core/telemetry', () => ({
  PlatformEvents: {
    workspaceMemberInvited: vi.fn(),
  },
}))

const mockGetSession = authMockFns.mockGetSession
const mockGetWorkspaceWithOwner = permissionsMockFns.mockGetWorkspaceWithOwner

import { UPGRADE_TO_INVITE_REASON } from '@/lib/workspaces/policy-constants'
import { POST } from '@/app/api/workspaces/invitations/batch/route'

afterAll(resetEnvFlagsMock)

describe('POST /api/workspaces/invitations/batch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockGetSession.mockResolvedValue({
      user: { id: 'user-1', email: 'owner@test.com', name: 'Owner User' },
    })
    mockGetWorkspaceWithOwner.mockResolvedValue({
      id: 'workspace-1',
      name: 'Workspace',
      ownerId: 'user-1',
      organizationId: null,
      workspaceMode: 'grandfathered_shared',
      billedAccountUserId: 'user-1',
    })
    permissionsMockFns.mockHasWorkspaceAdminAccess.mockResolvedValue(true)
    mockValidateInvitationsAllowed.mockResolvedValue(undefined)
    mockGetWorkspaceInvitePolicy.mockResolvedValue({
      allowed: true,
      reason: null,
      requiresSeat: false,
      organizationId: null,
      upgradeRequired: false,
    })
    mockValidateSeatAvailability.mockResolvedValue({
      canInvite: true,
      currentSeats: 1,
      maxSeats: 5,
      availableSeats: 4,
    })
    mockGetUserOrganization.mockResolvedValue(null)
    mockCreatePendingInvitation.mockImplementation(
      async (input: { grants: Array<{ workspaceId: string; permission: string }> }) => ({
        invitationId: 'inv-1',
        token: 'tok-1',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        created: true,
        addedWorkspaceIds: input.grants.map((grant) => grant.workspaceId),
        grants: input.grants,
      })
    )
    mockSendInvitationEmail.mockResolvedValue({ success: true })
    mockFindPendingGrantWorkspaceIds.mockResolvedValue(new Set())
    mockGetInvitePlanCategoryForUser.mockResolvedValue('free')
  })

  afterAll(() => {
    resetDbChainMock()
  })

  it('blocks invites for personal workspaces with an upgrade prompt', async () => {
    mockGetWorkspaceWithOwner.mockResolvedValueOnce({
      id: 'workspace-1',
      name: 'Personal Workspace',
      ownerId: 'user-1',
      organizationId: null,
      workspaceMode: 'personal',
      billedAccountUserId: 'user-1',
    })
    mockGetWorkspaceInvitePolicy.mockResolvedValueOnce({
      allowed: false,
      reason: UPGRADE_TO_INVITE_REASON,
      requiresSeat: false,
      organizationId: null,
      upgradeRequired: true,
    })

    const request = createMockRequest('POST', {
      workspaceIds: ['workspace-1'],
      emails: ['new@example.com'],
      permission: 'read',
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data.error).toBe(UPGRADE_TO_INVITE_REASON)
    expect(data.upgradeRequired).toBe(true)
  })

  it('blocks invites for grandfathered workspaces without a team plan', async () => {
    mockGetWorkspaceWithOwner.mockResolvedValueOnce({
      id: 'workspace-1',
      name: 'Grandfathered Workspace',
      ownerId: 'user-1',
      organizationId: null,
      workspaceMode: 'grandfathered_shared',
      billedAccountUserId: 'user-1',
    })
    mockGetWorkspaceInvitePolicy.mockResolvedValueOnce({
      allowed: false,
      reason: UPGRADE_TO_INVITE_REASON,
      requiresSeat: false,
      organizationId: null,
      upgradeRequired: true,
    })

    const request = createMockRequest('POST', {
      workspaceIds: ['workspace-1'],
      emails: ['new@example.com'],
      permission: 'read',
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data.upgradeRequired).toBe(true)
    expect(mockCreatePendingInvitation).not.toHaveBeenCalled()
  })

  it('reports org-owned invites as failed when the organization has no available seats', async () => {
    mockGetWorkspaceWithOwner.mockResolvedValueOnce({
      id: 'workspace-1',
      name: 'Org Workspace',
      ownerId: 'user-1',
      organizationId: 'org-1',
      workspaceMode: 'organization',
      billedAccountUserId: 'owner-1',
    })
    mockGetWorkspaceInvitePolicy.mockResolvedValueOnce({
      allowed: true,
      reason: null,
      requiresSeat: true,
      organizationId: 'org-1',
      upgradeRequired: false,
    })
    mockValidateSeatAvailability.mockResolvedValueOnce({
      canInvite: false,
      reason: 'No available seats. Currently using 5 of 5 seats.',
      currentSeats: 5,
      maxSeats: 5,
      availableSeats: 0,
    })

    const request = createMockRequest('POST', {
      workspaceIds: ['workspace-1'],
      emails: ['new@example.com'],
      permission: 'read',
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(false)
    expect(data.failed).toEqual([
      {
        email: 'new@example.com',
        error: 'No available seats. Currently using 5 of 5 seats.',
      },
    ])
    expect(mockValidateSeatAvailability).toHaveBeenCalledWith('org-1', 1)
    expect(mockCreatePendingInvitation).not.toHaveBeenCalled()
  })

  it('creates an external workspace invitation for users already in another organization', async () => {
    mockGetWorkspaceWithOwner.mockResolvedValueOnce({
      id: 'workspace-1',
      name: 'Org Workspace',
      ownerId: 'user-1',
      organizationId: 'org-1',
      workspaceMode: 'organization',
      billedAccountUserId: 'owner-1',
    })
    mockGetWorkspaceInvitePolicy.mockResolvedValueOnce({
      allowed: true,
      reason: null,
      requiresSeat: true,
      organizationId: 'org-1',
      upgradeRequired: false,
    })
    mockGetUserOrganization.mockResolvedValueOnce({
      organizationId: 'org-2',
      role: 'member',
      memberId: 'member-1',
    })
    queueTableRows(schemaMock.user, [{ id: 'existing-user', email: 'new@example.com' }])

    const request = createMockRequest('POST', {
      workspaceIds: ['workspace-1'],
      emails: ['new@example.com'],
      permission: 'read',
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.invitations[0].membershipIntent).toBe('external')
    expect(mockValidateSeatAvailability).not.toHaveBeenCalled()
    expect(mockCreatePendingInvitation).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'workspace',
        email: 'new@example.com',
        organizationId: 'org-1',
        membershipIntent: 'external',
        grants: [{ workspaceId: 'workspace-1', permission: 'read' }],
      })
    )
  })

  it('creates a unified workspace invitation for a grandfathered workspace', async () => {
    mockGetWorkspaceWithOwner.mockResolvedValueOnce({
      id: 'workspace-1',
      name: 'Grandfathered Workspace',
      ownerId: 'user-1',
      organizationId: null,
      workspaceMode: 'grandfathered_shared',
      billedAccountUserId: 'user-1',
    })

    const request = createMockRequest('POST', {
      workspaceIds: ['workspace-1'],
      emails: ['new@example.com'],
      permission: 'write',
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(mockCreatePendingInvitation).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'workspace',
        email: 'new@example.com',
        organizationId: null,
        grants: [{ workspaceId: 'workspace-1', permission: 'write' }],
      })
    )
    expect(mockSendInvitationEmail).toHaveBeenCalled()
    expect(mockValidateSeatAvailability).not.toHaveBeenCalled()
  })

  it('creates multiple workspace invitations in one batch request', async () => {
    const request = createMockRequest('POST', {
      workspaceIds: ['workspace-1'],
      emails: ['first@example.com', 'second@example.com'],
      permission: 'read',
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.successful).toEqual(['first@example.com', 'second@example.com'])
    expect(data.failed).toEqual([])
    expect(data.invitations).toHaveLength(2)
    expect(mockCreatePendingInvitation).toHaveBeenCalledTimes(2)
    expect(mockSendInvitationEmail).toHaveBeenCalledTimes(2)
  })

  it('coalesces several workspaces into one invitation and one email', async () => {
    mockGetWorkspaceWithOwner.mockResolvedValue({
      id: 'workspace-1',
      name: 'Org Workspace',
      ownerId: 'user-1',
      organizationId: 'org-1',
      workspaceMode: 'organization',
      billedAccountUserId: 'owner-1',
    })
    mockGetWorkspaceInvitePolicy.mockResolvedValue({
      allowed: true,
      reason: null,
      requiresSeat: false,
      organizationId: 'org-1',
      upgradeRequired: false,
    })

    const request = createMockRequest('POST', {
      workspaceIds: ['workspace-1', 'workspace-2'],
      emails: ['new@example.com'],
      permission: 'write',
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(mockCreatePendingInvitation).toHaveBeenCalledTimes(1)
    expect(mockCreatePendingInvitation).toHaveBeenCalledWith(
      expect.objectContaining({
        grants: [
          { workspaceId: 'workspace-1', permission: 'write' },
          { workspaceId: 'workspace-2', permission: 'write' },
        ],
      })
    )
    expect(mockSendInvitationEmail).toHaveBeenCalledTimes(1)
    expect(data.invitations[0].workspaceIds).toEqual(['workspace-1', 'workspace-2'])
  })

  it('reports a per-email failure when an external invite targets a free account', async () => {
    mockGetWorkspaceWithOwner.mockResolvedValueOnce({
      id: 'workspace-1',
      name: 'Org Workspace',
      ownerId: 'user-1',
      organizationId: 'org-1',
      workspaceMode: 'organization',
      billedAccountUserId: 'owner-1',
    })
    mockGetWorkspaceInvitePolicy.mockResolvedValueOnce({
      allowed: true,
      reason: null,
      requiresSeat: false,
      organizationId: 'org-1',
      upgradeRequired: false,
    })
    /**
     * The paid-plan requirement is a billing rule, so it only applies when
     * billing is on — with billing off there are no seats to protect and every
     * account reads as free.
     */
    setEnvFlags({ isBillingEnabled: true })
    queueTableRows(schemaMock.user, [{ id: 'free-user', email: 'free@example.com' }])
    mockGetUserOrganization.mockResolvedValueOnce(null)
    mockGetInvitePlanCategoryForUser.mockResolvedValueOnce('free')

    const request = createMockRequest('POST', {
      workspaceIds: ['workspace-1'],
      emails: ['free@example.com'],
      permission: 'write',
      membership: 'external',
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(false)
    expect(data.failed[0].email).toBe('free@example.com')
    expect(data.failed[0].error).toContain('not on a paid Sim plan')
    expect(mockCreatePendingInvitation).not.toHaveBeenCalled()
  })

  it('rolls back the unified invitation when email delivery fails', async () => {
    mockGetWorkspaceWithOwner.mockResolvedValueOnce({
      id: 'workspace-1',
      name: 'Org Workspace',
      ownerId: 'user-1',
      organizationId: 'org-1',
      workspaceMode: 'organization',
      billedAccountUserId: 'owner-1',
    })
    mockSendInvitationEmail.mockResolvedValueOnce({
      success: false,
      error: 'mailer unavailable',
    })

    const request = createMockRequest('POST', {
      workspaceIds: ['workspace-1'],
      emails: ['new@example.com'],
      permission: 'read',
    })

    const response = await POST(request)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        success: false,
        failed: [{ email: 'new@example.com', error: 'mailer unavailable' }],
      })
    )
    expect(mockCancelPendingInvitation).toHaveBeenCalledWith('inv-1')
  })
})
