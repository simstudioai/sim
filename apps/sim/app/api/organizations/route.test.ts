/**
 * @vitest-environment node
 */
import { member, subscription } from '@sim/db/schema'
import {
  auditMock,
  authMockFns,
  createSession,
  queueTableRows,
  resetDbChainMock,
} from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockSetActiveOrganizationForCurrentSession,
  mockCreateOrganizationForTeamPlan,
  mockEnsureOrganizationForTeamSubscription,
  mockAttachOwnedWorkspacesToOrganization,
  WorkspaceOrganizationMembershipConflictError,
} = vi.hoisted(() => ({
  mockSetActiveOrganizationForCurrentSession: vi.fn().mockResolvedValue(undefined),
  mockCreateOrganizationForTeamPlan: vi.fn(),
  mockEnsureOrganizationForTeamSubscription: vi.fn(),
  mockAttachOwnedWorkspacesToOrganization: vi.fn().mockResolvedValue(undefined),
  WorkspaceOrganizationMembershipConflictError: class WorkspaceOrganizationMembershipConflictError extends Error {},
}))

vi.mock('@sim/audit', () => auditMock)

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

const mockGetSession = authMockFns.mockGetSession

afterAll(resetDbChainMock)

describe('POST /api/organizations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('recovers an owner org when the subscription was already moved onto the organization', async () => {
    mockGetSession.mockResolvedValue(
      createSession({
        userId: 'user-1',
        email: 'owner@example.com',
        name: 'Owner',
      })
    )
    queueTableRows(member, [{ organizationId: 'legacy-org-id', role: 'owner' }])
    queueTableRows(subscription, [
      { id: 'sub-1', plan: 'team', referenceId: 'legacy-org-id', status: 'active', seats: 5 },
    ])

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
      externalMemberPolicy: 'keep-external',
      includeArchived: true,
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
    queueTableRows(member, [{ organizationId: 'legacy-org-id', role: 'owner' }])
    queueTableRows(subscription, [
      { id: 'sub-1', plan: 'team', referenceId: 'user-1', status: 'active', seats: 5 },
    ])

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
    queueTableRows(member, [{ organizationId: 'org-1', role: 'member' }])

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
    queueTableRows(member, [{ organizationId: 'legacy-org-id', role: 'owner' }])
    queueTableRows(subscription, [
      { id: 'sub-1', plan: 'team', referenceId: 'legacy-org-id', status: 'active', seats: 5 },
    ])
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
