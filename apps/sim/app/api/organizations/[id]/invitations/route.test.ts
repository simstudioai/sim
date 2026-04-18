/**
 * @vitest-environment node
 */
import { auditMock, createSession, loggerMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockDbState,
  mockGetSession,
  mockValidateInvitationsAllowed,
  mockValidateSeatAvailability,
  mockCreatePendingInvitation,
  mockSendInvitationEmail,
  mockCancelPendingInvitation,
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
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => ({ type: 'and', conditions })),
  eq: vi.fn((field: unknown, value: unknown) => ({ field, value })),
  inArray: vi.fn((field: unknown, values: unknown[]) => ({ field, values })),
}))

vi.mock('@sim/logger', () => loggerMock)

vi.mock('@/lib/audit/log', () => auditMock)

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
      new Request('http://localhost/api/organizations/org-1/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emails: ['invitee@example.com'] }),
      }) as any,
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
      new Request('http://localhost/api/organizations/org-1/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emails: ['invitee@example.com'] }),
      }) as any,
      { params: Promise.resolve({ id: 'org-1' }) }
    )

    expect(response.status).toBe(502)
    expect(mockCancelPendingInvitation).toHaveBeenCalledWith('inv-1')
  })
})
