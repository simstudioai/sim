/**
 * @vitest-environment node
 */
import { auditMock, createSession, loggerMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockDbState,
  mockGetSession,
  mockSetActiveOrganizationForCurrentSession,
  mockCreateOrganizationForTeamPlan,
  mockEnsureOrganizationForTeamSubscription,
  mockAttachOwnedWorkspacesToOrganization,
  WorkspaceOrganizationMembershipConflictError,
} = vi.hoisted(() => ({
  mockDbState: {
    selectResults: [] as any[],
  },
  mockGetSession: vi.fn(),
  mockSetActiveOrganizationForCurrentSession: vi.fn().mockResolvedValue(undefined),
  mockCreateOrganizationForTeamPlan: vi.fn(),
  mockEnsureOrganizationForTeamSubscription: vi.fn(),
  mockAttachOwnedWorkspacesToOrganization: vi.fn().mockResolvedValue(undefined),
  WorkspaceOrganizationMembershipConflictError: class WorkspaceOrganizationMembershipConflictError extends Error {},
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
  },
}))

vi.mock('@sim/db/schema', () => ({
  member: {
    organizationId: 'member.organizationId',
    role: 'member.role',
    userId: 'member.userId',
  },
  organization: {
    id: 'organization.id',
    name: 'organization.name',
  },
  subscription: {
    id: 'subscription.id',
    plan: 'subscription.plan',
    referenceId: 'subscription.referenceId',
    status: 'subscription.status',
    seats: 'subscription.seats',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => ({ type: 'and', conditions })),
  eq: vi.fn((field: unknown, value: unknown) => ({ field, value })),
  inArray: vi.fn((field: unknown, value: unknown[]) => ({ field, value })),
  or: vi.fn((...conditions: unknown[]) => ({ type: 'or', conditions })),
}))

vi.mock('@sim/logger', () => loggerMock)

vi.mock('@/lib/audit/log', () => auditMock)

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))

vi.mock('@/lib/auth/active-organization', () => ({
  setActiveOrganizationForCurrentSession: mockSetActiveOrganizationForCurrentSession,
}))

vi.mock('@/lib/billing/organization', () => ({
  createOrganizationForTeamPlan: mockCreateOrganizationForTeamPlan,
  ensureOrganizationForTeamSubscription: mockEnsureOrganizationForTeamSubscription,
}))

vi.mock('@/lib/billing/organizations/create-organization', () => ({
  OrganizationSlugInvalidError: class OrganizationSlugInvalidError extends Error {},
  OrganizationSlugTakenError: class OrganizationSlugTakenError extends Error {},
}))

vi.mock('@/lib/billing/plan-helpers', () => ({
  isOrgPlan: (plan: string) => plan === 'team' || plan === 'enterprise',
}))

vi.mock('@/lib/billing/subscriptions/utils', () => ({
  ENTITLED_SUBSCRIPTION_STATUSES: ['active', 'trialing'],
}))

vi.mock('@/lib/workspaces/organization-workspaces', () => ({
  attachOwnedWorkspacesToOrganization: mockAttachOwnedWorkspacesToOrganization,
  WorkspaceOrganizationMembershipConflictError,
}))

import { POST } from '@/app/api/organizations/route'

describe('POST /api/organizations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDbState.selectResults = []
  })

  it('recovers an owner org when the subscription was already moved onto the organization', async () => {
    mockGetSession.mockResolvedValue(
      createSession({
        userId: 'user-1',
        email: 'owner@example.com',
        name: 'Owner',
      })
    )
    mockDbState.selectResults = [
      [{ organizationId: 'legacy-org-id', role: 'owner' }],
      [{ id: 'sub-1', plan: 'team', referenceId: 'legacy-org-id', status: 'active', seats: 5 }],
    ]

    const response = await POST(
      new Request('http://localhost/api/organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Recovered Org' }),
      })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      organizationId: 'legacy-org-id',
      created: false,
    })
    expect(mockAttachOwnedWorkspacesToOrganization).toHaveBeenCalledWith({
      ownerUserId: 'user-1',
      organizationId: 'legacy-org-id',
    })
    expect(mockCreateOrganizationForTeamPlan).not.toHaveBeenCalled()
    expect(mockEnsureOrganizationForTeamSubscription).not.toHaveBeenCalled()
    expect(mockSetActiveOrganizationForCurrentSession).toHaveBeenCalledWith('legacy-org-id')
    expect(auditMock.recordAudit).not.toHaveBeenCalled()
  })

  it('recovers an owner org when the subscription is still linked to the user', async () => {
    mockGetSession.mockResolvedValue(
      createSession({
        userId: 'user-1',
        email: 'owner@example.com',
        name: 'Owner',
      })
    )
    mockEnsureOrganizationForTeamSubscription.mockResolvedValue({
      id: 'sub-1',
      plan: 'team',
      referenceId: 'legacy-org-id',
      status: 'active',
      seats: 5,
    })
    mockDbState.selectResults = [
      [{ organizationId: 'legacy-org-id', role: 'owner' }],
      [{ id: 'sub-1', plan: 'team', referenceId: 'user-1', status: 'active', seats: 5 }],
    ]

    const response = await POST(
      new Request('http://localhost/api/organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Recovered Org' }),
      })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      organizationId: 'legacy-org-id',
      created: false,
    })
    expect(mockEnsureOrganizationForTeamSubscription).toHaveBeenCalledWith({
      id: 'sub-1',
      plan: 'team',
      referenceId: 'user-1',
      status: 'active',
      seats: 5,
    })
    expect(mockAttachOwnedWorkspacesToOrganization).not.toHaveBeenCalled()
    expect(mockCreateOrganizationForTeamPlan).not.toHaveBeenCalled()
  })

  it('still blocks users who are only members of another organization', async () => {
    mockGetSession.mockResolvedValue(
      createSession({
        userId: 'user-1',
        email: 'member@example.com',
        name: 'Member',
      })
    )
    mockDbState.selectResults = [[{ organizationId: 'org-1', role: 'member' }]]

    const response = await POST(
      new Request('http://localhost/api/organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Blocked Org' }),
      })
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error:
        'You are already a member of an organization. Leave your current organization before creating a new one.',
    })
    expect(mockEnsureOrganizationForTeamSubscription).not.toHaveBeenCalled()
    expect(mockCreateOrganizationForTeamPlan).not.toHaveBeenCalled()
    expect(mockAttachOwnedWorkspacesToOrganization).not.toHaveBeenCalled()
  })

  it('returns a conflict when existing shared workspace members block organization attachment', async () => {
    mockGetSession.mockResolvedValue(
      createSession({
        userId: 'user-1',
        email: 'owner@example.com',
        name: 'Owner',
      })
    )
    mockDbState.selectResults = [
      [{ organizationId: 'legacy-org-id', role: 'owner' }],
      [{ id: 'sub-1', plan: 'team', referenceId: 'legacy-org-id', status: 'active', seats: 5 }],
    ]
    mockAttachOwnedWorkspacesToOrganization.mockRejectedValueOnce(
      new WorkspaceOrganizationMembershipConflictError([
        { userId: 'user-2', organizationId: 'org-2' },
      ])
    )

    const response = await POST(
      new Request('http://localhost/api/organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Recovered Org' }),
      })
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error:
        'One or more members of your existing shared workspaces already belong to another organization. Remove them from those workspaces before converting them to organization-owned workspaces.',
    })
    expect(mockSetActiveOrganizationForCurrentSession).not.toHaveBeenCalled()
  })
})
