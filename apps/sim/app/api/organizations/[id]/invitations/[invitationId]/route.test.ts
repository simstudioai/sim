/**
 * @vitest-environment node
 */
import { auditMock, createSession, loggerMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDbState, mockGetSession, mockSendEmail } = vi.hoisted(() => ({
  mockDbState: {
    selectResults: [] as any[],
    updateCalls: [] as Array<{ table: unknown; values: Record<string, unknown> }>,
  },
  mockGetSession: vi.fn(),
  mockSendEmail: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: {
    select: vi.fn().mockImplementation(() => {
      const chain: any = {}
      chain.from = vi.fn().mockReturnValue(chain)
      chain.where = vi.fn().mockReturnValue(chain)
      chain.limit = vi
        .fn()
        .mockImplementation(() => Promise.resolve(mockDbState.selectResults.shift() ?? []))
      chain.then = vi
        .fn()
        .mockImplementation((callback: (rows: any[]) => any) =>
          Promise.resolve(callback(mockDbState.selectResults.shift() ?? []))
        )
      return chain
    }),
    update: vi.fn().mockImplementation((table: unknown) => ({
      set: vi.fn().mockImplementation((values: Record<string, unknown>) => {
        mockDbState.updateCalls.push({ table, values })
        return {
          where: vi.fn().mockResolvedValue(undefined),
        }
      }),
    })),
    transaction: vi.fn(),
  },
}))

vi.mock('@sim/db/schema', () => ({
  invitation: {
    id: 'invitation.id',
    organizationId: 'invitation.organizationId',
    status: 'invitation.status',
    email: 'invitation.email',
    role: 'invitation.role',
    expiresAt: 'invitation.expiresAt',
    inviterId: 'invitation.inviterId',
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
  permissionGroup: {
    id: 'permissionGroup.id',
    name: 'permissionGroup.name',
    organizationId: 'permissionGroup.organizationId',
    autoAddNewMembers: 'permissionGroup.autoAddNewMembers',
  },
  permissionGroupMember: {
    id: 'permissionGroupMember.id',
    userId: 'permissionGroupMember.userId',
    permissionGroupId: 'permissionGroupMember.permissionGroupId',
  },
  permissions: {
    id: 'permissions.id',
    entityId: 'permissions.entityId',
    entityType: 'permissions.entityType',
    userId: 'permissions.userId',
    permissionType: 'permissions.permissionType',
  },
  user: {
    id: 'user.id',
    name: 'user.name',
    email: 'user.email',
  },
  workspaceEnvironment: {
    workspaceId: 'workspaceEnvironment.workspaceId',
    variables: 'workspaceEnvironment.variables',
  },
  workspaceInvitation: {
    id: 'workspaceInvitation.id',
    orgInvitationId: 'workspaceInvitation.orgInvitationId',
    status: 'workspaceInvitation.status',
    updatedAt: 'workspaceInvitation.updatedAt',
    expiresAt: 'workspaceInvitation.expiresAt',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => ({ type: 'and', conditions })),
  eq: vi.fn((field: unknown, value: unknown) => ({ field, value })),
  or: vi.fn((...conditions: unknown[]) => ({ type: 'or', conditions })),
}))

vi.mock('@sim/logger', () => loggerMock)

vi.mock('@/lib/audit/log', () => auditMock)

vi.mock('@/components/emails', () => ({
  getEmailSubject: vi.fn().mockReturnValue('Organization invite'),
  renderInvitationEmail: vi.fn().mockResolvedValue('<html></html>'),
}))

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))

vi.mock('@/lib/auth/active-organization', () => ({
  setActiveOrganizationForCurrentSession: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/billing', () => ({
  hasAccessControlAccess: vi.fn().mockResolvedValue(false),
}))

vi.mock('@/lib/billing/core/usage', () => ({
  syncUsageLimitsFromSubscription: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/billing/organizations/membership', () => ({
  ensureUserInOrganization: vi.fn(),
}))

vi.mock('@/lib/core/utils/urls', () => ({
  getBaseUrl: vi.fn().mockReturnValue('https://test.sim.ai'),
}))

vi.mock('@/lib/core/utils/uuid', () => ({
  generateId: vi.fn().mockReturnValue('generated-id'),
}))

vi.mock('@/lib/credentials/environment', () => ({
  syncWorkspaceEnvCredentials: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/messaging/email/mailer', () => ({
  sendEmail: mockSendEmail,
}))

import { POST, PUT } from '@/app/api/organizations/[id]/invitations/[invitationId]/route'

describe('organization invitation route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDbState.selectResults = []
    mockDbState.updateCalls = []
    mockSendEmail.mockResolvedValue({ success: true })
  })

  it('rejects expired invitations before accepting them', async () => {
    mockGetSession.mockResolvedValue(
      createSession({
        userId: 'user-1',
        email: 'invitee@example.com',
        name: 'Invitee',
      })
    )
    mockDbState.selectResults = [
      [
        {
          id: 'invite-1',
          organizationId: 'org-1',
          status: 'pending',
          email: 'invitee@example.com',
          role: 'member',
          expiresAt: new Date(Date.now() - 1000),
        },
      ],
    ]

    const response = await PUT(
      new Request('http://localhost/api/organizations/org-1/invitations/invite-1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'accepted' }),
      }) as any,
      { params: Promise.resolve({ id: 'org-1', invitationId: 'invite-1' }) }
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Invitation has expired' })
    expect(mockDbState.updateCalls).toEqual([])
  })

  it('extends linked workspace invitations when resending an org invitation', async () => {
    mockGetSession.mockResolvedValue(
      createSession({
        userId: 'user-1',
        email: 'owner@example.com',
        name: 'Owner',
      })
    )
    mockDbState.selectResults = [
      [{ role: 'owner' }],
      [{ id: 'invite-1', email: 'invitee@example.com', status: 'pending', role: 'member' }],
      [{ name: 'Org One' }],
      [{ name: 'Owner' }],
    ]

    const response = await POST(
      new Request('http://localhost/api/organizations/org-1/invitations/invite-1', {
        method: 'POST',
      }) as any,
      { params: Promise.resolve({ id: 'org-1', invitationId: 'invite-1' }) }
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      message: 'Invitation resent successfully',
    })
    expect(mockDbState.updateCalls).toHaveLength(2)
    expect(mockDbState.updateCalls[0].values).toEqual({
      expiresAt: expect.any(Date),
    })
    expect(mockDbState.updateCalls[1]).toEqual({
      table: expect.objectContaining({
        id: 'workspaceInvitation.id',
        orgInvitationId: 'workspaceInvitation.orgInvitationId',
      }),
      values: expect.objectContaining({
        expiresAt: mockDbState.updateCalls[0].values.expiresAt,
        updatedAt: expect.any(Date),
      }),
    })
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
  })
})
