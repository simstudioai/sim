import { member } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  lock: vi.fn(),
  scim: vi.fn(),
  change: vi.fn(),
  audit: vi.fn(),
  analytics: vi.fn(),
}))
vi.mock('@sim/platform-authz/workspace', () => ({
  isOrgAdminRole: (role: string) => role === 'admin' || role === 'owner',
}))
vi.mock('@/lib/permission-groups/resolve.server', () => ({
  getUserPermissionConfigForOrganization: async () => null,
}))
vi.mock('@/lib/billing/organizations/membership', () => ({
  acquireOrganizationUserMutationLocks: mocks.lock,
}))
vi.mock('@/ee/scim/lib/managed-membership', () => ({ assertMembershipNotScimManaged: mocks.scim }))
vi.mock('@/lib/organizations/members/lifecycle', () => ({ changeMemberRoleTx: mocks.change }))
vi.mock('@sim/audit', () => ({
  AuditAction: { ORG_MEMBER_ROLE_CHANGED: 'org.member.role' },
  AuditResourceType: { ORGANIZATION: 'organization' },
  recordAudit: mocks.audit,
}))
vi.mock('@/lib/billing/core/organization', () => ({ getOrganizationMemberUsageSnapshot: vi.fn() }))
vi.mock('@/lib/billing/organizations/seats', () => ({ reconcileOrganizationSeats: vi.fn() }))
vi.mock('@/lib/auth/active-organization', () => ({
  setActiveOrganizationForCurrentSession: vi.fn(),
}))
vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: mocks.analytics }))

import { updateOrganizationMember } from '@/lib/organizations/application/members'

const principal = {
  kind: 'organization_delegated',
  serviceId: 'copilot',
  subjectUserId: 'actor',
  organizationId: 'org',
  delegationId: 'role',
  audience: 'sim:settings',
  issuedAt: new Date(),
  expiresAt: new Date(Date.now() + 60_000),
  resourceScope: { chatId: 'chat' },
} as const
const input = { organizationId: 'org', userId: 'target-user', role: 'admin' } as const
beforeEach(() => {
  resetDbChainMock()
  mocks.scim.mockResolvedValue(undefined)
  mocks.change.mockResolvedValue({ changed: true, from: 'member', to: 'admin' })
})
describe('organization role update', () => {
  it.each(['owner', 'admin'])(
    'preserves locked role change for current %s and audits actual actor',
    async (role) => {
      queueTableRows(member, [{ role }])
      queueTableRows(member, [{ role: 'admin' }])
      queueTableRows(member, [
        {
          id: 'member-id',
          userId: 'target-user',
          role: 'member',
          email: 'target@example.com',
          name: 'Target',
        },
      ])
      await expect(updateOrganizationMember.execute({ principal, input })).resolves.toEqual({
        member: expect.objectContaining({ id: 'member-id', userId: 'target-user', role: 'admin' }),
        previousRole: 'member',
        changed: true,
      })
      expect(mocks.lock).toHaveBeenCalledBefore(mocks.scim)
      expect(mocks.scim).toHaveBeenCalledBefore(mocks.change)
      expect(mocks.change).toHaveBeenCalledWith(expect.anything(), {
        actorUserId: 'actor',
        organizationId: 'org',
        userId: 'target-user',
        role: 'admin',
      })
      expect(mocks.audit).toHaveBeenCalledWith(
        expect.objectContaining({ actorId: 'actor', resourceId: 'org' })
      )
    }
  )
  it.each([
    { targetRole: 'owner', newRole: 'admin' },
    { targetRole: 'member', newRole: 'owner' },
  ] as const)('refuses ownership change', async ({ targetRole, newRole }) => {
    queueTableRows(member, [{ role: 'admin' }])
    queueTableRows(member, [{ role: 'admin' }])
    queueTableRows(member, [{ role: targetRole }])
    await expect(
      updateOrganizationMember.execute({ principal, input: { ...input, role: newRole } })
    ).rejects.toMatchObject({ code: 'validation' })
    expect(mocks.change).not.toHaveBeenCalled()
  })
})

it.each([{ role: 'member' }, { role: null }])(
  'rejects insufficient current authority before mutation',
  async ({ role }) => {
    queueTableRows(member, role ? [{ role }] : [])
    await expect(updateOrganizationMember.execute({ principal, input })).rejects.toThrow()
    expect(dbChainMockFns.transaction).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
  }
)
it('preserves SCIM authority and emits no audit on refusal', async () => {
  queueTableRows(member, [{ role: 'admin' }])
  queueTableRows(member, [{ role: 'admin' }])
  queueTableRows(member, [{ role: 'member' }])
  mocks.scim.mockRejectedValueOnce(new Error('Managed by directory'))
  await expect(updateOrganizationMember.execute({ principal, input })).rejects.toThrow(
    'Managed by directory'
  )
  expect(mocks.change).not.toHaveBeenCalled()
  expect(mocks.audit).not.toHaveBeenCalled()
})
