import { member, user } from '@sim/db/schema'
import { authMockFns, createMockRequest, queueTableRows, resetDbChainMock } from '@sim/testing'
import { createRouteContext } from '@sim/testing/helpers/http'
import { auditMock, auditMockFns } from '@sim/testing/mocks/audit.mock'
import { billingOrganizationMock } from '@sim/testing/mocks/billing-organization.mock'
import {
  organizationMembershipMock,
  organizationMembershipMockFns,
} from '@sim/testing/mocks/organization-membership.mock'
import {
  organizationSeatsMock,
  organizationSeatsMockFns,
} from '@sim/testing/mocks/organization-seats.mock'
import { permissionGroupsResolveMock } from '@sim/testing/mocks/permission-groups-resolve.mock'
import { posthogServerMock } from '@sim/testing/mocks/posthog-server.mock'
import { workspaceAuthzMock } from '@sim/testing/mocks/workspace-authz.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  active: vi.fn(),
}))
vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
vi.mock('@/lib/permission-groups/resolve.server', () => permissionGroupsResolveMock)
vi.mock('@/lib/billing/organizations/membership', () => organizationMembershipMock)
vi.mock('@/lib/billing/organizations/seats', () => organizationSeatsMock)
vi.mock('@/lib/billing/core/organization', () => billingOrganizationMock)
vi.mock('@/lib/auth/active-organization', () => ({
  setActiveOrganizationForCurrentSession: hoisted.active,
}))
vi.mock('@/lib/posthog/server', () => posthogServerMock)
vi.mock('@sim/audit', () => auditMock)
vi.mock('@/ee/scim/lib/managed-membership', () => ({ assertMembershipNotScimManaged: vi.fn() }))

import { removeOrganizationMember } from '@/lib/organizations/application/members'
import { DELETE } from '@/app/api/organizations/[id]/members/[memberId]/route'

const mocks = {
  ...hoisted,
  seats: organizationSeatsMockFns.mockReconcileOrganizationSeats,
  remove: organizationMembershipMockFns.mockRemoveUserFromOrganization,
  external: organizationMembershipMockFns.mockRemoveExternalUserFromOrganizationWorkspaces,
  audit: auditMockFns.mockRecordAudit,
}

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
      createRouteContext({ id: 'org', memberId: 'actor' })
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
  it.each([
    'Cannot remove organization owner',
    'Cannot remove the workspace billing account. Please reassign billing first.',
  ])('preserves lifecycle refusal %s', async (error) => {
    target()
    mocks.remove.mockResolvedValueOnce({ success: false, error })
    await expect(removeOrganizationMember.execute({ principal, input })).rejects.toMatchObject({
      code: 'validation',
    })
    expect(mocks.seats).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
  })
})
