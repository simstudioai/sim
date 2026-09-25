import type { OrganizationDelegatedPrincipal, Principal } from '@sim/auth/principal'
import {
  auditMock,
  auditMockFns,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
  setEnvFlags,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  userRead: vi.fn(),
  userUpdate: vi.fn(),
  orgRead: vi.fn(),
  orgUpdate: vi.fn(),
  admin: vi.fn(),
  summary: vi.fn(),
  memberRead: vi.fn(),
  memberUpdate: vi.fn(),
  usage: vi.fn(),
  subscription: vi.fn(),
}))
vi.mock('@sim/audit', () => auditMock)
vi.mock('@/lib/billing', () => ({
  getUserUsageLimitInfo: mocks.userRead,
  updateUserUsageLimit: mocks.userUpdate,
}))
vi.mock('@/lib/billing/core/organization', () => ({
  getOrganizationBillingData: mocks.orgRead,
  updateOrganizationUsageLimit: mocks.orgUpdate,
  isOrganizationOwnerOrAdmin: mocks.admin,
}))
vi.mock(
  '@/lib/billing/application/organization-billing-summary/get-organization-billing-summary',
  () => ({ getOrganizationBillingSummary: { execute: mocks.summary } })
)
vi.mock('@/lib/billing/organizations/member-limits', () => ({
  isOrgMemberUsageLimitTarget: vi.fn().mockResolvedValue(true),
  getOrgMemberUsageLimit: mocks.memberRead,
  setOrgMemberUsageLimit: mocks.memberUpdate,
  getOrgMemberUsageForCurrentPeriod: mocks.usage,
}))
vi.mock('@/lib/billing/core/billing', () => ({ getOrganizationSubscription: mocks.subscription }))
vi.mock('@/lib/permission-groups/resolve.server', () => ({
  getUserPermissionConfigForOrganization: async () => null,
}))

import { updateOrganizationMemberUsageLimit } from '@/lib/billing/application/member-usage-limits/use-cases'
import { readUsageLimit, updateUsageLimit } from '@/lib/billing/application/usage-limits'

const principal = (): OrganizationDelegatedPrincipal => ({
  kind: 'organization_delegated',
  serviceId: 'copilot',
  subjectUserId: 'actor',
  organizationId: 'org',
  delegationId: 'grant',
  audience: 'sim:settings',
  issuedAt: new Date(Date.now() - 1000),
  expiresAt: new Date(Date.now() + 60000),
  resourceScope: { chatId: 'chat' },
})
const session: Principal = { kind: 'session', userId: 'actor', sessionId: 'session' }
function membership(role = 'admin') {
  queueTableRows(schemaMock.member, [{ role }])
}
beforeEach(() => {
  resetDbChainMock()
  setEnvFlags({ isHosted: true })
  mocks.admin.mockResolvedValue(true)
  mocks.userUpdate.mockResolvedValue({ success: true })
  mocks.orgUpdate.mockResolvedValue({ success: true })
  mocks.orgRead.mockResolvedValue(null)
  mocks.userRead.mockResolvedValue({ limit: 20 })
  mocks.memberRead.mockResolvedValue(2)
  mocks.usage.mockResolvedValue(1)
  mocks.subscription.mockResolvedValue(null)
})
describe('budget settings application boundaries', () => {
  it('rejects ordinary members before updating', async () => {
    membership('member')
    await expect(
      updateUsageLimit.execute({
        principal: principal(),
        input: { context: 'organization', organizationId: 'org', limit: 100 },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.orgUpdate).not.toHaveBeenCalled()
  })
  it.each([
    { organizationId: 'other' },
    { audience: 'sim:copilot' },
    { expiresAt: new Date(0) },
    { resourceScope: { chatId: '' } },
  ])('rejects invalid delegated grants %j', async (patch) => {
    await expect(
      updateUsageLimit.execute({
        principal: { ...principal(), ...patch },
        input: { context: 'organization', organizationId: 'org', limit: 100 },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.orgUpdate).not.toHaveBeenCalled()
  })
  it('preserves plan/minimum failure messages without reading a success response', async () => {
    mocks.orgUpdate.mockResolvedValue({ success: false, error: 'Enterprise limits are fixed' })
    await expect(
      updateUsageLimit.execute({
        principal: session,
        input: { context: 'organization', organizationId: 'org', limit: 100 },
      })
    ).rejects.toMatchObject({ code: 'validation', message: 'Enterprise limits are fixed' })
    expect(mocks.orgRead).not.toHaveBeenCalled()
  })
  it('does not allow a different account read', async () => {
    await expect(
      readUsageLimit.execute({ principal: session, input: { userId: 'other' } })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.userRead).not.toHaveBeenCalled()
  })
  it('rejects negative caps without billing changes', async () => {
    await expect(
      updateUsageLimit.execute({ principal: session, input: { limit: -1 } })
    ).rejects.toMatchObject({ code: 'validation' })
    expect(mocks.userUpdate).not.toHaveBeenCalled()
  })
  it.each([400, null])(
    'updates or clears external member cap %s with actual actor',
    async (creditLimit) => {
      membership()
      membership()
      await updateOrganizationMemberUsageLimit.execute({
        principal: principal(),
        input: { organizationId: 'org', userId: 'external-user', creditLimit },
      })
      expect(mocks.memberUpdate).toHaveBeenCalledWith(
        'org',
        'external-user',
        creditLimit === null ? null : 2,
        'actor',
        expect.anything()
      )
      expect(auditMockFns.mockRecordAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'actor',
          metadata: expect.objectContaining({ targetUserId: 'external-user', creditLimit }),
        })
      )
    }
  )
  it('keeps member cap hosted-only and does not audit rejected writes', async () => {
    setEnvFlags({ isHosted: false })
    await expect(
      updateOrganizationMemberUsageLimit.execute({
        principal: session,
        input: { organizationId: 'org', userId: 'other', creditLimit: 4 },
      })
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(mocks.memberUpdate).not.toHaveBeenCalled()
    expect(auditMockFns.mockRecordAudit).not.toHaveBeenCalled()
  })
})
