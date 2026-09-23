/** @vitest-environment node */
import { member, user } from '@sim/db/schema'
import { authMockFns, createMockRequest, queueTableRows, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  remove: vi.fn(),
  external: vi.fn(),
  seats: vi.fn(),
  audit: vi.fn(),
  active: vi.fn(),
  analytics: vi.fn(),
}))
vi.mock('@sim/platform-authz/workspace', () => ({
  isOrgAdminRole: (role: string) => role === 'admin' || role === 'owner',
}))
vi.mock('@/lib/permission-groups/resolve.server', () => ({
  getUserPermissionConfigForOrganization: async () => null,
}))
vi.mock('@/lib/billing/organizations/membership', () => ({
  removeUserFromOrganization: mocks.remove,
  removeExternalUserFromOrganizationWorkspaces: mocks.external,
  WORKSPACE_BILLING_ACCOUNT_REMOVAL_ERROR: 'Billing ownership must be transferred',
  acquireOrganizationUserMutationLocks: vi.fn(),
}))
vi.mock('@/lib/billing/organizations/seats', () => ({ reconcileOrganizationSeats: mocks.seats }))
vi.mock('@/lib/billing/core/organization', () => ({ getOrganizationMemberUsageSnapshot: vi.fn() }))
vi.mock('@/lib/auth/active-organization', () => ({
  setActiveOrganizationForCurrentSession: mocks.active,
}))
vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: mocks.analytics }))
vi.mock('@sim/audit', () => ({
  AuditAction: { ORG_MEMBER_REMOVED: 'member.removed' },
  AuditResourceType: { ORGANIZATION: 'organization' },
  recordAudit: mocks.audit,
}))
vi.mock('@/ee/scim/lib/managed-membership', () => ({ assertMembershipNotScimManaged: vi.fn() }))

import { removeOrganizationMember } from '@/lib/organizations/application/members'
import { DELETE } from '@/app/api/organizations/[id]/members/[memberId]/route'

const principal = {
  kind: 'organization_delegated',
  serviceId: 'copilot',
  subjectUserId: 'actor',
  organizationId: 'org',
  delegationId: 'remove',
  audience: 'sim:settings',
  issuedAt: new Date(),
  expiresAt: new Date(Date.now() + 60_000),
  resourceScope: { chatId: 'chat' },
} as const
const input = { organizationId: 'org', userId: 'target' }
beforeEach(() => {
  vi.clearAllMocks()
  resetDbChainMock()
  mocks.remove.mockResolvedValue({ success: true, billingActions: {} })
  mocks.seats.mockResolvedValue({ changed: false })
  mocks.external.mockResolvedValue({
    success: true,
    workspaceAccessRevoked: 2,
    permissionGroupsRevoked: 1,
    credentialMembershipsRevoked: 1,
    pendingInvitationsCancelled: 1,
  })
})
function target(role = 'admin') {
  queueTableRows(member, [{ role }])
  queueTableRows(member, [
    {
      id: 'member-id',
      userId: 'target',
      role: 'member',
      name: 'Target',
      email: 'target@example.com',
    },
  ])
  queueTableRows(user, [{ name: 'Actor', email: 'actor@example.com' }])
}
describe('organization member removal', () => {
  it('uses the real member removal lifecycle without a fabricated session token', async () => {
    target()
    await expect(removeOrganizationMember.execute({ principal, input })).resolves.toMatchObject({
      removedBy: 'actor',
      target: expect.objectContaining({ userId: 'target' }),
    })
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith({
      userId: 'target',
      organizationId: 'org',
      memberId: 'member-id',
      actorUserId: 'actor',
      onError: 'throw',
    })
    expect(mocks.seats).toHaveBeenCalledWith({
      organizationId: 'org',
      actorId: 'actor',
      reason: 'member-removed',
    })
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ actorId: 'actor' }))
  })
  it('refuses ordinary members removing somebody else', async () => {
    target('member')
    await expect(removeOrganizationMember.execute({ principal, input })).rejects.toMatchObject({
      code: 'forbidden',
    })
    expect(mocks.remove).not.toHaveBeenCalled()
  })
  it('allows a member to leave using their authenticated session id and finalizes browser scope', async () => {
    target('member')
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: 'actor' },
      session: { id: 'live-session' },
    })
    const response = await DELETE(
      createMockRequest(
        'DELETE',
        undefined,
        {},
        'http://localhost/api/organizations/org/members/actor'
      ),
      { params: Promise.resolve({ id: 'org', memberId: 'actor' }) }
    )
    expect(response.status).toBe(200)
    expect(mocks.remove).toHaveBeenCalledWith({
      userId: 'actor',
      organizationId: 'org',
      memberId: 'member-id',
      spareSessionId: 'live-session',
      actorUserId: 'actor',
      onError: 'throw',
    })
    expect(mocks.active).toHaveBeenCalledWith(null)
  })
  it('retains external removal grant counts and skips seat changes', async () => {
    queueTableRows(member, [{ role: 'admin' }])
    queueTableRows(member, [])
    queueTableRows(user, [{ id: 'target', name: 'External' }])
    const result = await removeOrganizationMember.execute({ principal, input })
    expect(result.removal).toMatchObject({
      workspaceAccessRevoked: 2,
      credentialMembershipsRevoked: 1,
    })
    expect(mocks.external).toHaveBeenCalledWith({
      userId: 'target',
      organizationId: 'org',
      actorUserId: 'actor',
    })
    expect(mocks.seats).not.toHaveBeenCalled()
  })
  it('preserves completed removal and reports seat reconciliation failure', async () => {
    target()
    mocks.seats.mockRejectedValueOnce(new Error('stripe-unavailable'))
    const result = await removeOrganizationMember.execute({ principal, input })
    expect(result.seatReduction).toEqual({
      changed: false,
      reason: 'Failed to reduce seats after member removal',
    })
    expect(mocks.audit).toHaveBeenCalledTimes(1)
  })
  it.each(['Cannot remove organization owner', 'Billing ownership must be transferred'])(
    'preserves lifecycle refusal %s',
    async (error) => {
      target()
      mocks.remove.mockResolvedValueOnce({ success: false, error })
      await expect(removeOrganizationMember.execute({ principal, input })).rejects.toMatchObject({
        code: 'validation',
      })
      expect(mocks.seats).not.toHaveBeenCalled()
      expect(mocks.audit).not.toHaveBeenCalled()
    }
  )
})
