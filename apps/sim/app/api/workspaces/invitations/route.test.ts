/**
 * @vitest-environment node
 */
import {
  auditMock,
  authMock,
  authMockFns,
  createMockRequest,
  permissionsMock,
  permissionsMockFns,
  schemaMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetWorkspaceInvitePolicy,
  mockValidateInvitationsAllowed,
  mockValidateSeatAvailability,
  mockGetUserOrganization,
  mockCreatePendingInvitation,
  mockSendInvitationEmail,
  mockCancelPendingInvitation,
  mockFindPendingGrantForWorkspaceEmail,
  mockDbResults,
} = vi.hoisted(() => ({
  mockGetWorkspaceInvitePolicy: vi.fn(),
  mockValidateInvitationsAllowed: vi.fn().mockResolvedValue(undefined),
  mockValidateSeatAvailability: vi.fn(),
  mockGetUserOrganization: vi.fn(),
  mockCreatePendingInvitation: vi.fn(),
  mockSendInvitationEmail: vi.fn(),
  mockCancelPendingInvitation: vi.fn(),
  mockFindPendingGrantForWorkspaceEmail: vi.fn(),
  mockDbResults: { value: [] as any[] },
}))

vi.mock('@sim/db', () => ({
  db: {
    select: vi.fn().mockImplementation(() => {
      const chain: any = {}
      chain.from = vi.fn().mockReturnValue(chain)
      chain.innerJoin = vi.fn().mockReturnValue(chain)
      chain.where = vi.fn().mockReturnValue(chain)
      chain.limit = vi
        .fn()
        .mockImplementation(() => Promise.resolve(mockDbResults.value.shift() || []))
      chain.then = vi.fn().mockImplementation((callback: (rows: any[]) => unknown) => {
        const result = mockDbResults.value.shift() || []
        return Promise.resolve(callback ? callback(result) : result)
      })
      return chain
    }),
  },
}))

vi.mock('@sim/db/schema', () => schemaMock)

vi.mock('@/lib/auth', () => authMock)

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

vi.mock('@/lib/workspaces/policy', () => ({
  getWorkspaceInvitePolicy: mockGetWorkspaceInvitePolicy,
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
  findPendingGrantForWorkspaceEmail: mockFindPendingGrantForWorkspaceEmail,
}))

vi.mock('@/lib/invitations/core', () => ({
  normalizeEmail: (email: string) => email.trim().toLowerCase(),
  listInvitationsForWorkspaces: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/ee/access-control/utils/permission-check', () => ({
  validateInvitationsAllowed: mockValidateInvitationsAllowed,
  InvitationsNotAllowedError: class InvitationsNotAllowedError extends Error {},
}))

vi.mock('@/lib/audit/log', () => auditMock)

vi.mock('@/lib/posthog/server', () => ({
  captureServerEvent: vi.fn(),
}))

vi.mock('@/lib/core/telemetry', () => ({
  PlatformEvents: {
    workspaceMemberInvited: vi.fn(),
  },
}))

const mockGetSession = authMockFns.mockGetSession
const mockGetWorkspaceWithOwner = permissionsMockFns.mockGetWorkspaceWithOwner

import { UPGRADE_TO_INVITE_REASON } from '@/lib/workspaces/policy-constants'
import { POST } from '@/app/api/workspaces/invitations/route'

describe('POST /api/workspaces/invitations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDbResults.value = []
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
    mockCreatePendingInvitation.mockResolvedValue({
      invitationId: 'inv-1',
      token: 'tok-1',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    })
    mockSendInvitationEmail.mockResolvedValue({ success: true })
    mockFindPendingGrantForWorkspaceEmail.mockResolvedValue(null)
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
    mockDbResults.value = [[{ permissionType: 'admin' }]]

    const request = createMockRequest('POST', {
      workspaceId: 'workspace-1',
      email: 'new@example.com',
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
    mockDbResults.value = [[{ permissionType: 'admin' }]]

    const request = createMockRequest('POST', {
      workspaceId: 'workspace-1',
      email: 'new@example.com',
      permission: 'read',
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data.upgradeRequired).toBe(true)
    expect(mockCreatePendingInvitation).not.toHaveBeenCalled()
  })

  it('rejects org-owned invites when the organization has no available seats', async () => {
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
    mockDbResults.value = [[{ permissionType: 'admin' }], []]

    const request = createMockRequest('POST', {
      workspaceId: 'workspace-1',
      email: 'new@example.com',
      permission: 'read',
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toContain('No available seats')
    expect(mockValidateSeatAvailability).toHaveBeenCalledWith('org-1', 1)
    expect(mockCreatePendingInvitation).not.toHaveBeenCalled()
  })

  it('rejects org-owned invites for users already in another organization', async () => {
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
    mockDbResults.value = [
      [{ permissionType: 'admin' }],
      [{ id: 'existing-user', email: 'new@example.com' }],
    ]

    const request = createMockRequest('POST', {
      workspaceId: 'workspace-1',
      email: 'new@example.com',
      permission: 'read',
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(409)
    expect(data.error).toContain('already a member of another organization')
    expect(mockCreatePendingInvitation).not.toHaveBeenCalled()
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
    mockDbResults.value = [[{ permissionType: 'admin' }], []]

    const request = createMockRequest('POST', {
      workspaceId: 'workspace-1',
      email: 'new@example.com',
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
    mockDbResults.value = [[{ permissionType: 'admin' }], []]

    const request = createMockRequest('POST', {
      workspaceId: 'workspace-1',
      email: 'new@example.com',
      permission: 'read',
    })

    const response = await POST(request)

    expect(response.status).toBe(502)
    expect(mockCancelPendingInvitation).toHaveBeenCalledWith('inv-1')
  })
})
