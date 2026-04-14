/**
 * @vitest-environment node
 */
import { auditMock, createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetSession,
  mockGetWorkspaceWithOwner,
  mockValidateInvitationsAllowed,
  mockValidateSeatAvailability,
  mockGetUserOrganization,
  mockSendEmail,
  mockRender,
  mockDbResults,
  mockInsertValues,
  mockLogger,
} = vi.hoisted(() => {
  const mockGetSession = vi.fn()
  const mockGetWorkspaceWithOwner = vi.fn()
  const mockValidateInvitationsAllowed = vi.fn().mockResolvedValue(undefined)
  const mockValidateSeatAvailability = vi.fn().mockResolvedValue({
    canInvite: true,
    currentSeats: 1,
    maxSeats: 5,
    availableSeats: 4,
  })
  const mockGetUserOrganization = vi.fn().mockResolvedValue(null)
  const mockSendEmail = vi.fn().mockResolvedValue({ success: true })
  const mockRender = vi.fn().mockResolvedValue('<html>email content</html>')
  const mockDbResults: { value: any[] } = { value: [] }
  const mockInsertValues = vi.fn().mockResolvedValue(undefined)
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }

  return {
    mockGetSession,
    mockGetWorkspaceWithOwner,
    mockValidateInvitationsAllowed,
    mockValidateSeatAvailability,
    mockGetUserOrganization,
    mockSendEmail,
    mockRender,
    mockDbResults,
    mockInsertValues,
    mockLogger,
  }
})

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))

vi.mock('@sim/db', () => ({
  db: {
    select: vi.fn().mockImplementation(() => {
      const chain: any = {}
      chain.from = vi.fn().mockReturnValue(chain)
      chain.where = vi.fn().mockReturnValue(chain)
      chain.innerJoin = vi.fn().mockReturnValue(chain)
      chain.limit = vi
        .fn()
        .mockImplementation(() => Promise.resolve(mockDbResults.value.shift() || []))
      chain.then = vi.fn().mockImplementation((callback: (rows: any[]) => unknown) => {
        const result = mockDbResults.value.shift() || []
        return Promise.resolve(callback ? callback(result) : result)
      })
      return chain
    }),
    insert: vi.fn().mockReturnValue({
      values: mockInsertValues,
    }),
  },
}))

vi.mock('@sim/db/schema', () => ({
  user: { id: 'user_id', email: 'user_email', name: 'user_name' },
  workspace: { id: 'workspace_id', name: 'workspace_name', archivedAt: 'archived_at' },
  permissions: {
    entityId: 'entity_id',
    entityType: 'entity_type',
    userId: 'user_id',
    permissionType: 'permission_type',
  },
  workspaceInvitation: {
    id: 'id',
    workspaceId: 'workspaceId',
    email: 'email',
    inviterId: 'inviterId',
    role: 'role',
    status: 'status',
    token: 'token',
    permissions: 'permissions',
    expiresAt: 'expiresAt',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
  },
  permissionTypeEnum: { enumValues: ['admin', 'write', 'read'] as const },
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getWorkspaceWithOwner: mockGetWorkspaceWithOwner,
}))

vi.mock('@/lib/workspaces/policy', () => ({
  canWorkspaceInviteMembers: (workspace: { workspaceMode?: string | null }) =>
    workspace.workspaceMode !== 'personal',
  getWorkspaceInviteDisabledReason: () =>
    'Member invites are only available for organization-owned or grandfathered shared workspaces.',
  isOrganizationWorkspace: (workspace: {
    workspaceMode?: string | null
    organizationId?: string | null
  }) => workspace.workspaceMode === 'organization' && !!workspace.organizationId,
}))

vi.mock('@/lib/billing/validation/seat-management', () => ({
  validateSeatAvailability: mockValidateSeatAvailability,
}))

vi.mock('@/lib/billing/organizations/membership', () => ({
  getUserOrganization: mockGetUserOrganization,
}))

vi.mock('@/ee/access-control/utils/permission-check', () => ({
  validateInvitationsAllowed: mockValidateInvitationsAllowed,
  InvitationsNotAllowedError: class InvitationsNotAllowedError extends Error {},
}))

vi.mock('@/components/emails', () => ({
  WorkspaceInvitationEmail: vi.fn().mockReturnValue(null),
}))

vi.mock('@react-email/render', () => ({
  render: mockRender,
}))

vi.mock('@/lib/messaging/email/mailer', () => ({
  sendEmail: mockSendEmail,
}))

vi.mock('@/lib/messaging/email/utils', () => ({
  getFromEmailAddress: vi.fn().mockReturnValue('noreply@test.com'),
}))

vi.mock('@/lib/core/utils/urls', () => ({
  getBaseUrl: vi.fn().mockReturnValue('https://test.sim.ai'),
}))

vi.mock('@/lib/core/utils/uuid', () => ({
  generateId: vi.fn().mockReturnValue('generated-id'),
}))

vi.mock('@/lib/audit/log', async () => {
  return auditMock
})

vi.mock('@/lib/posthog/server', () => ({
  captureServerEvent: vi.fn(),
}))

vi.mock('@sim/logger', () => ({
  createLogger: vi.fn().mockReturnValue(mockLogger),
}))

vi.mock('@/lib/core/telemetry', () => ({
  PlatformEvents: {
    workspaceMemberInvited: vi.fn(),
  },
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => ({ type: 'and', conditions })),
  eq: vi.fn((field: unknown, value: unknown) => ({ type: 'eq', field, value })),
  inArray: vi.fn((field: unknown, values: unknown[]) => ({ type: 'inArray', field, values })),
  isNull: vi.fn((field: unknown) => ({ type: 'isNull', field })),
}))

import { POST } from '@/app/api/workspaces/invitations/route'

describe('Workspace Invitations API Route', () => {
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
    mockValidateSeatAvailability.mockResolvedValue({
      canInvite: true,
      currentSeats: 1,
      maxSeats: 5,
      availableSeats: 4,
    })
    mockGetUserOrganization.mockResolvedValue(null)
    mockInsertValues.mockResolvedValue(undefined)
    mockSendEmail.mockResolvedValue({ success: true })
    mockRender.mockResolvedValue('<html>email content</html>')
  })

  it('blocks direct invites for personal workspaces', async () => {
    mockGetWorkspaceWithOwner.mockResolvedValueOnce({
      id: 'workspace-1',
      name: 'Personal Workspace',
      ownerId: 'user-1',
      organizationId: null,
      workspaceMode: 'personal',
      billedAccountUserId: 'user-1',
    })
    mockDbResults.value = [[{ permissionType: 'admin' }]]

    const request = createMockRequest('POST', {
      workspaceId: 'workspace-1',
      email: 'new@example.com',
      permission: 'read',
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toContain('Member invites are only available')
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
    mockGetUserOrganization.mockResolvedValueOnce({
      organizationId: 'org-2',
      role: 'member',
      memberId: 'member-1',
    })
    mockDbResults.value = [
      [{ permissionType: 'admin' }],
      [{ id: 'existing-user', email: 'new@example.com' }],
      [],
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
  })

  it('creates a grandfathered shared workspace invite successfully', async () => {
    mockGetWorkspaceWithOwner.mockResolvedValueOnce({
      id: 'workspace-1',
      name: 'Grandfathered Workspace',
      ownerId: 'user-1',
      organizationId: null,
      workspaceMode: 'grandfathered_shared',
      billedAccountUserId: 'user-1',
    })
    mockDbResults.value = [[{ permissionType: 'admin' }], [], []]

    const request = createMockRequest('POST', {
      workspaceId: 'workspace-1',
      email: 'new@example.com',
      permission: 'write',
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(mockInsertValues).toHaveBeenCalled()
    expect(mockValidateSeatAvailability).not.toHaveBeenCalled()
  })
})
