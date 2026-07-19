/**
 * @vitest-environment node
 */
import { auditMock, createMockRequest, createSession, loggerMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockDbState,
  mockGetSession,
  mockValidateInvitationsAllowed,
  mockValidateSeatAvailability,
  mockCreatePendingInvitation,
  mockSendInvitationEmail,
  mockCancelPendingInvitation,
  mockGrantWorkspaceAccessDirectly,
} = vi.hoisted(() => ({
  mockDbState: {
    selectResults: [] as any[],
  },
  mockGetSession: vi.fn(),
  mockValidateInvitationsAllowed: vi.fn(),
  mockValidateSeatAvailability: vi.fn(),
  mockCreatePendingInvitation: vi.fn(),
  mockSendInvitationEmail: vi.fn(),
  mockCancelPendingInvitation: vi.fn(),
  mockGrantWorkspaceAccessDirectly: vi.fn(),
}))

function createSelectChain() {
  const chain: any = {}
  chain.from = vi.fn().mockReturnValue(chain)
  chain.innerJoin = vi.fn().mockReturnValue(chain)
  chain.leftJoin = vi.fn().mockReturnValue(chain)
  chain.where = vi.fn().mockReturnValue(chain)
  chain.orderBy = vi.fn().mockReturnValue(chain)
  chain.limit = vi
    .fn()
    .mockImplementation(() => Promise.resolve(mockDbState.selectResults.shift() ?? []))
  chain.then = vi.fn().mockImplementation((callback: (rows: any[]) => unknown) => {
    const rows = mockDbState.selectResults.shift() ?? []
    return Promise.resolve(callback(rows))
  })
  return chain
}

vi.mock('@sim/db', () => ({
  db: {
    select: vi.fn().mockImplementation(() => createSelectChain()),
  },
}))

vi.mock('@sim/db/schema', () => ({
  account: {},
  credential: {},
  credentialTypeEnum: { enumValues: ['oauth', 'secret', 'api_key'] },
  invitation: {
    id: 'invitation.id',
    organizationId: 'invitation.organizationId',
    status: 'invitation.status',
    email: 'invitation.email',
    kind: 'invitation.kind',
    role: 'invitation.role',
    inviterId: 'invitation.inviterId',
    expiresAt: 'invitation.expiresAt',
    createdAt: 'invitation.createdAt',
  },
  member: {
    organizationId: 'member.organizationId',
    userId: 'member.userId',
    role: 'member.role',
  },
  organization: {
    id: 'organization.id',
    name: 'organization.name',
  },
  user: {
    id: 'user.id',
    name: 'user.name',
    email: 'user.email',
  },
  workspace: {
    id: 'workspace.id',
    name: 'workspace.name',
    organizationId: 'workspace.organizationId',
    workspaceMode: 'workspace.workspaceMode',
  },
  permissions: {
    entityId: 'permissions.entityId',
    entityType: 'permissions.entityType',
    userId: 'permissions.userId',
  },
  invitationWorkspaceGrant: {
    invitationId: 'invitationWorkspaceGrant.invitationId',
    workspaceId: 'invitationWorkspaceGrant.workspaceId',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => ({ type: 'and', conditions })),
  eq: vi.fn((field: unknown, value: unknown) => ({ field, value })),
  inArray: vi.fn((field: unknown, values: unknown[]) => ({ field, values })),
}))

vi.mock('@sim/logger', () => loggerMock)

vi.mock('@sim/audit', () => auditMock)

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))

vi.mock('@/lib/billing/validation/seat-management', () => ({
  validateBulkInvitations: vi.fn(),
  validateSeatAvailability: mockValidateSeatAvailability,
}))

vi.mock('@/lib/invitations/send', () => ({
  createPendingInvitation: mockCreatePendingInvitation,
  sendInvitationEmail: mockSendInvitationEmail,
  cancelPendingInvitation: mockCancelPendingInvitation,
}))

vi.mock('@/lib/invitations/direct-grant', () => ({
  grantWorkspaceAccessDirectly: mockGrantWorkspaceAccessDirectly,
}))

vi.mock('@/lib/messaging/email/validation', () => ({
  quickValidateEmail: vi.fn((email: string) => ({ isValid: email.includes('@') })),
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  hasWorkspaceAdminAccess: vi.fn().mockResolvedValue(true),
}))

vi.mock('@/lib/workspaces/policy', () => ({
  isOrganizationWorkspace: vi.fn().mockReturnValue(true),
}))

vi.mock('@/ee/access-control/utils/permission-check', () => ({
  InvitationsNotAllowedError: class InvitationsNotAllowedError extends Error {},
  validateInvitationsAllowed: mockValidateInvitationsAllowed,
}))

import { POST } from '@/app/api/organizations/[id]/invitations/route'

describe('POST /api/organizations/[id]/invitations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDbState.selectResults = []
    mockValidateInvitationsAllowed.mockResolvedValue(undefined)
    mockValidateSeatAvailability.mockResolvedValue({
      canInvite: true,
      currentSeats: 1,
      maxSeats: 5,
      availableSeats: 4,
    })
    mockCreatePendingInvitation.mockResolvedValue({
      invitationId: 'inv-1',
      token: 'tok-1',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    })
    mockSendInvitationEmail.mockResolvedValue({ success: true })
    mockGrantWorkspaceAccessDirectly.mockResolvedValue({ outcome: 'added', permission: 'write' })
  })

  it('creates a unified invitation and sends a single email', async () => {
    mockGetSession.mockResolvedValue(
      createSession({ userId: 'user-1', email: 'owner@example.com', name: 'Owner' })
    )
    mockDbState.selectResults = [
      [{ role: 'owner' }],
      [{ name: 'Org One' }],
      [],
      [],
      [{ name: 'Owner', email: 'owner@example.com' }],
    ]

    const response = await POST(
      createMockRequest(
        'POST',
        { emails: ['invitee@example.com'] },
        {},
        'http://localhost/api/organizations/org-1/invitations'
      ),
      { params: Promise.resolve({ id: 'org-1' }) }
    )

    expect(response.status).toBe(200)
    expect(mockCreatePendingInvitation).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'organization',
        email: 'invitee@example.com',
        organizationId: 'org-1',
        role: 'member',
        grants: [],
      })
    )
    expect(mockSendInvitationEmail).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'organization', email: 'invitee@example.com' })
    )
    expect(mockCancelPendingInvitation).not.toHaveBeenCalled()
  })

  it('adds an existing member directly to selected workspaces they lack (no invitation/email)', async () => {
    mockGetSession.mockResolvedValue(
      createSession({ userId: 'user-1', email: 'owner@example.com', name: 'Owner' })
    )
    mockDbState.selectResults = [
      [{ role: 'owner' }],
      [{ name: 'Org One' }],
      [{ id: 'ws-1', name: 'Workspace 1', organizationId: 'org-1', workspaceMode: 'organization' }],
      [{ id: 'ws-2', name: 'Workspace 2', organizationId: 'org-1', workspaceMode: 'organization' }],
      [{ userId: 'user-2', userEmail: 'member@example.com' }],
      [],
      [{ userId: 'user-2', workspaceId: 'ws-1' }],
      [],
      [{ name: 'Owner', email: 'owner@example.com' }],
    ]

    const response = await POST(
      createMockRequest(
        'POST',
        {
          emails: ['member@example.com'],
          workspaceInvitations: [
            { workspaceId: 'ws-1', permission: 'write' },
            { workspaceId: 'ws-2', permission: 'write' },
          ],
        },
        {},
        'http://localhost/api/organizations/org-1/invitations?batch=true'
      ),
      { params: Promise.resolve({ id: 'org-1' }) }
    )

    expect(response.status).toBe(200)
    expect(mockCreatePendingInvitation).not.toHaveBeenCalled()
    expect(mockSendInvitationEmail).not.toHaveBeenCalled()
    expect(mockGrantWorkspaceAccessDirectly).toHaveBeenCalledTimes(1)
    expect(mockGrantWorkspaceAccessDirectly).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-2',
        email: 'member@example.com',
        workspaceId: 'ws-2',
        permission: 'write',
        organizationId: 'org-1',
      })
    )

    const body = await response.json()
    expect(body.data.invitationsSent).toBe(0)
    expect(body.data.directlyAdded).toEqual(['member@example.com'])
    expect(body.data.directlyAddedCount).toBe(1)
    expect(body.data.existingMembers).toEqual([])
  })

  it('reports a partially-failed member only as added, never in both buckets', async () => {
    mockGetSession.mockResolvedValue(
      createSession({ userId: 'user-1', email: 'owner@example.com', name: 'Owner' })
    )
    // First grant succeeds, second throws (e.g. transient DB error).
    mockGrantWorkspaceAccessDirectly
      .mockResolvedValueOnce({ outcome: 'added', permission: 'write' })
      .mockRejectedValueOnce(new Error('db blip'))
    mockDbState.selectResults = [
      [{ role: 'owner' }],
      [{ name: 'Org One' }],
      [{ id: 'ws-1', name: 'Workspace 1', organizationId: 'org-1', workspaceMode: 'organization' }],
      [{ id: 'ws-2', name: 'Workspace 2', organizationId: 'org-1', workspaceMode: 'organization' }],
      [{ userId: 'user-2', userEmail: 'member@example.com' }],
      [],
      [],
      [],
      [{ name: 'Owner', email: 'owner@example.com' }],
    ]

    const response = await POST(
      createMockRequest(
        'POST',
        {
          emails: ['member@example.com'],
          workspaceInvitations: [
            { workspaceId: 'ws-1', permission: 'write' },
            { workspaceId: 'ws-2', permission: 'write' },
          ],
        },
        {},
        'http://localhost/api/organizations/org-1/invitations?batch=true'
      ),
      { params: Promise.resolve({ id: 'org-1' }) }
    )

    expect(response.status).toBe(200)
    expect(mockGrantWorkspaceAccessDirectly).toHaveBeenCalledTimes(2)
    const body = await response.json()
    expect(body.data.directlyAdded).toEqual(['member@example.com'])
    expect(body.data.failedInvitations).toEqual([])
  })

  it('returns 207 with both successes and failures when one member is added and another fails', async () => {
    mockGetSession.mockResolvedValue(
      createSession({ userId: 'user-1', email: 'owner@example.com', name: 'Owner' })
    )
    mockGrantWorkspaceAccessDirectly
      .mockResolvedValueOnce({ outcome: 'added', permission: 'write' })
      .mockRejectedValueOnce(new Error('db blip'))
    mockDbState.selectResults = [
      [{ role: 'owner' }],
      [{ name: 'Org One' }],
      [{ id: 'ws-1', name: 'Workspace 1', organizationId: 'org-1', workspaceMode: 'organization' }],
      [
        { userId: 'user-a', userEmail: 'a@example.com' },
        { userId: 'user-b', userEmail: 'b@example.com' },
      ],
      [],
      [],
      [],
      [{ name: 'Owner', email: 'owner@example.com' }],
    ]

    const response = await POST(
      createMockRequest(
        'POST',
        {
          emails: ['a@example.com', 'b@example.com'],
          workspaceInvitations: [{ workspaceId: 'ws-1', permission: 'write' }],
        },
        {},
        'http://localhost/api/organizations/org-1/invitations?batch=true'
      ),
      { params: Promise.resolve({ id: 'org-1' }) }
    )

    expect(response.status).toBe(207)
    const body = await response.json()
    expect(body.success).toBe(false)
    expect(body.data.directlyAdded).toEqual(['a@example.com'])
    expect(body.data.directlyAddedCount).toBe(1)
    expect(body.data.failedInvitations).toEqual([{ email: 'b@example.com', error: 'db blip' }])
  })

  it('returns 400 when an existing member already has access to every selected workspace', async () => {
    mockGetSession.mockResolvedValue(
      createSession({ userId: 'user-1', email: 'owner@example.com', name: 'Owner' })
    )
    mockDbState.selectResults = [
      [{ role: 'owner' }],
      [{ name: 'Org One' }],
      [{ id: 'ws-1', organizationId: 'org-1', workspaceMode: 'organization' }],
      [{ userId: 'user-2', userEmail: 'member@example.com' }],
      [],
      [{ userId: 'user-2', workspaceId: 'ws-1' }],
      [],
    ]

    const response = await POST(
      createMockRequest(
        'POST',
        {
          emails: ['member@example.com'],
          workspaceInvitations: [{ workspaceId: 'ws-1', permission: 'write' }],
        },
        {},
        'http://localhost/api/organizations/org-1/invitations?batch=true'
      ),
      { params: Promise.resolve({ id: 'org-1' }) }
    )

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toContain('already has access')
    expect(mockCreatePendingInvitation).not.toHaveBeenCalled()
  })

  it('invites new emails to the organization and adds existing members to workspaces in one batch', async () => {
    mockGetSession.mockResolvedValue(
      createSession({ userId: 'user-1', email: 'owner@example.com', name: 'Owner' })
    )
    mockDbState.selectResults = [
      [{ role: 'owner' }],
      [{ name: 'Org One' }],
      [{ id: 'ws-1', name: 'Workspace 1', organizationId: 'org-1', workspaceMode: 'organization' }],
      [{ userId: 'user-2', userEmail: 'member@example.com' }],
      [],
      [],
      [],
      [{ name: 'Owner', email: 'owner@example.com' }],
    ]

    const response = await POST(
      createMockRequest(
        'POST',
        {
          emails: ['new@example.com', 'member@example.com'],
          workspaceInvitations: [{ workspaceId: 'ws-1', permission: 'read' }],
        },
        {},
        'http://localhost/api/organizations/org-1/invitations?batch=true'
      ),
      { params: Promise.resolve({ id: 'org-1' }) }
    )

    expect(response.status).toBe(200)
    expect(mockCreatePendingInvitation).toHaveBeenCalledTimes(1)
    expect(mockCreatePendingInvitation).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'organization',
        email: 'new@example.com',
        grants: [{ workspaceId: 'ws-1', permission: 'read' }],
      })
    )
    expect(mockGrantWorkspaceAccessDirectly).toHaveBeenCalledTimes(1)
    expect(mockGrantWorkspaceAccessDirectly).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-2',
        email: 'member@example.com',
        workspaceId: 'ws-1',
        permission: 'read',
      })
    )

    const body = await response.json()
    expect(body.data.invitationsSent).toBe(1)
    expect(body.data.invitedEmails).toEqual(['new@example.com'])
    expect(body.data.directlyAdded).toEqual(['member@example.com'])
    expect(body.data.directlyAddedCount).toBe(1)
  })

  it('still rejects existing members on the non-batch organization invite path', async () => {
    mockGetSession.mockResolvedValue(
      createSession({ userId: 'user-1', email: 'owner@example.com', name: 'Owner' })
    )
    mockDbState.selectResults = [
      [{ role: 'owner' }],
      [{ name: 'Org One' }],
      [{ userId: 'user-2', userEmail: 'member@example.com' }],
      [],
    ]

    const response = await POST(
      createMockRequest(
        'POST',
        { emails: ['member@example.com'] },
        {},
        'http://localhost/api/organizations/org-1/invitations'
      ),
      { params: Promise.resolve({ id: 'org-1' }) }
    )

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toBe(
      'Failed to send invitation. User is already a part of the organization.'
    )
    expect(mockCreatePendingInvitation).not.toHaveBeenCalled()
  })

  it('rolls back the pending invitation when email delivery fails', async () => {
    mockGetSession.mockResolvedValue(
      createSession({ userId: 'user-1', email: 'owner@example.com', name: 'Owner' })
    )
    mockDbState.selectResults = [
      [{ role: 'owner' }],
      [{ name: 'Org One' }],
      [],
      [],
      [{ name: 'Owner', email: 'owner@example.com' }],
    ]
    mockSendInvitationEmail.mockResolvedValue({ success: false, error: 'mailer unavailable' })

    const response = await POST(
      createMockRequest(
        'POST',
        { emails: ['invitee@example.com'] },
        {},
        'http://localhost/api/organizations/org-1/invitations'
      ),
      { params: Promise.resolve({ id: 'org-1' }) }
    )

    expect(response.status).toBe(502)
    expect(mockCancelPendingInvitation).toHaveBeenCalledWith('inv-1')
  })
})
