/**
 * @vitest-environment node
 */
import { auditMock, createSession, loggerMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockDbState,
  mockGetSession,
  mockSendEmail,
  mockValidateInvitationsAllowed,
  mockValidateSeatAvailability,
} = vi.hoisted(() => ({
  mockDbState: {
    selectResults: [] as any[],
    updateCalls: [] as Array<{ table: unknown; values: Record<string, unknown> }>,
    insertCalls: [] as Array<{ table: unknown; values: unknown }>,
  },
  mockGetSession: vi.fn(),
  mockSendEmail: vi.fn(),
  mockValidateInvitationsAllowed: vi.fn(),
  mockValidateSeatAvailability: vi.fn(),
}))

function createSelectChain() {
  const chain: any = {}
  chain.from = vi.fn().mockReturnValue(chain)
  chain.innerJoin = vi.fn().mockReturnValue(chain)
  chain.where = vi.fn().mockReturnValue(chain)
  chain.limit = vi
    .fn()
    .mockImplementation(() => Promise.resolve(mockDbState.selectResults.shift() ?? []))
  chain.then = vi.fn().mockImplementation((callback: (rows: any[]) => unknown) => {
    const rows = mockDbState.selectResults.shift() ?? []
    return Promise.resolve(callback(rows))
  })
  return chain
}

function createUpdateChain(table: unknown) {
  return {
    set: vi.fn().mockImplementation((values: Record<string, unknown>) => {
      mockDbState.updateCalls.push({ table, values })
      return {
        where: vi.fn().mockResolvedValue(undefined),
      }
    }),
  }
}

vi.mock('@sim/db', () => ({
  db: {
    select: vi.fn().mockImplementation(() => createSelectChain()),
    insert: vi.fn().mockImplementation((table: unknown) => ({
      values: vi.fn().mockImplementation((values: unknown) => {
        mockDbState.insertCalls.push({ table, values })
        return Promise.resolve(undefined)
      }),
    })),
    update: vi.fn().mockImplementation((table: unknown) => createUpdateChain(table)),
    transaction: vi.fn().mockImplementation(async (callback: (tx: unknown) => Promise<void>) =>
      callback({
        update: vi.fn().mockImplementation((table: unknown) => createUpdateChain(table)),
      })
    ),
  },
}))

vi.mock('@sim/db/schema', () => ({
  invitation: {
    id: 'invitation.id',
    organizationId: 'invitation.organizationId',
    status: 'invitation.status',
    email: 'invitation.email',
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
  workspaceInvitation: {
    id: 'workspaceInvitation.id',
    orgInvitationId: 'workspaceInvitation.orgInvitationId',
    status: 'workspaceInvitation.status',
    updatedAt: 'workspaceInvitation.updatedAt',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => ({ type: 'and', conditions })),
  eq: vi.fn((field: unknown, value: unknown) => ({ field, value })),
  inArray: vi.fn((field: unknown, values: unknown[]) => ({ field, values })),
  isNull: vi.fn((field: unknown) => ({ field, type: 'isNull' })),
  or: vi.fn((...conditions: unknown[]) => ({ type: 'or', conditions })),
}))

vi.mock('@sim/logger', () => loggerMock)

vi.mock('@/components/emails', () => ({
  getEmailSubject: vi.fn().mockReturnValue('Organization invite'),
  renderBatchInvitationEmail: vi.fn().mockResolvedValue('<html></html>'),
  renderInvitationEmail: vi.fn().mockResolvedValue('<html></html>'),
}))

vi.mock('@/lib/audit/log', () => auditMock)

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))

vi.mock('@/lib/billing/validation/seat-management', () => ({
  validateBulkInvitations: vi.fn(),
  validateSeatAvailability: mockValidateSeatAvailability,
}))

vi.mock('@/lib/core/utils/urls', () => ({
  getBaseUrl: vi.fn().mockReturnValue('https://test.sim.ai'),
}))

vi.mock('@/lib/core/utils/uuid', () => ({
  generateId: vi.fn().mockReturnValue('generated-id'),
}))

vi.mock('@/lib/messaging/email/mailer', () => ({
  sendEmail: mockSendEmail,
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
    mockDbState.updateCalls = []
    mockDbState.insertCalls = []
    mockValidateInvitationsAllowed.mockResolvedValue(undefined)
    mockValidateSeatAvailability.mockResolvedValue({
      canInvite: true,
      currentSeats: 1,
      maxSeats: 5,
      availableSeats: 4,
    })
  })

  it('cancels pending invite rows and reports failure when email delivery fails', async () => {
    mockGetSession.mockResolvedValue(
      createSession({
        userId: 'user-1',
        email: 'owner@example.com',
        name: 'Owner',
      })
    )
    mockDbState.selectResults = [
      [{ role: 'owner' }],
      [{ name: 'Org One' }],
      [],
      [],
      [{ name: 'Owner' }],
    ]
    mockSendEmail.mockResolvedValue({
      success: false,
      message: 'mailer unavailable',
    })

    const response = await POST(
      new Request('http://localhost/api/organizations/org-1/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          emails: ['invitee@example.com'],
        }),
      }) as any,
      { params: Promise.resolve({ id: 'org-1' }) }
    )

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'Failed to send invitation emails.',
      message: 'No invitation emails could be delivered.',
      data: {
        invitationsSent: 0,
        invitedEmails: [],
        failedInvitations: [
          {
            email: 'invitee@example.com',
            error: 'mailer unavailable',
          },
        ],
        existingMembers: [],
        pendingInvitations: [],
        invalidEmails: [],
        workspaceInvitations: 0,
        seatInfo: {
          seatsUsed: 1,
          maxSeats: 5,
          availableSeats: 4,
        },
      },
    })
    expect(mockDbState.updateCalls).toEqual([
      {
        table: expect.objectContaining({
          id: 'invitation.id',
          organizationId: 'invitation.organizationId',
        }),
        values: { status: 'cancelled' },
      },
      {
        table: expect.objectContaining({
          id: 'workspaceInvitation.id',
          orgInvitationId: 'workspaceInvitation.orgInvitationId',
        }),
        values: expect.objectContaining({
          status: 'cancelled',
          updatedAt: expect.any(Date),
        }),
      },
    ])
  })
})
