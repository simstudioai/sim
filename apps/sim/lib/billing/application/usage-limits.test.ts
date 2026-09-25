import type { OrganizationDelegatedPrincipal } from '@sim/auth/principal'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { auditMock, auditMockFns } from '@sim/testing/mocks/audit.mock'
import { billingCoreMock, billingCoreMockFns } from '@sim/testing/mocks/billing-core.mock'
import {
  billingOrganizationMock,
  billingOrganizationMockFns,
} from '@sim/testing/mocks/billing-organization.mock'
import { queueTableRows, resetDbChainMock } from '@sim/testing/mocks/database.mock'
import { setEnvFlags } from '@sim/testing/mocks/env-flags.mock'
import {
  organizationMemberLimitsMock,
  organizationMemberLimitsMockFns,
} from '@sim/testing/mocks/organization-member-limits.mock'
import { permissionGroupsResolveMock } from '@sim/testing/mocks/permission-groups-resolve.mock'
import { schemaMock } from '@sim/testing/mocks/schema.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  userRead: vi.fn(),
  userUpdate: vi.fn(),
  summary: vi.fn(),
}))
vi.mock('@sim/audit', () => auditMock)
vi.mock('@/lib/billing', () => ({
  getUserUsageLimitInfo: hoisted.userRead,
  updateUserUsageLimit: hoisted.userUpdate,
}))
vi.mock('@/lib/billing/core/organization', () => billingOrganizationMock)
vi.mock(
  '@/lib/billing/application/organization-billing-summary/get-organization-billing-summary',
  () => ({ getOrganizationBillingSummary: { execute: hoisted.summary } })
)
vi.mock('@/lib/billing/organizations/member-limits', () => organizationMemberLimitsMock)
vi.mock('@/lib/billing/core/billing', () => billingCoreMock)
vi.mock('@/lib/permission-groups/resolve.server', () => permissionGroupsResolveMock)

import { updateOrganizationMemberUsageLimit } from '@/lib/billing/application/member-usage-limits/use-cases'
import { readUsageLimit, updateUsageLimit } from '@/lib/billing/application/usage-limits'

const mocks = {
  ...hoisted,
  memberRead: organizationMemberLimitsMockFns.mockGetOrgMemberUsageLimit,
  memberUpdate: organizationMemberLimitsMockFns.mockSetOrgMemberUsageLimit,
  usage: organizationMemberLimitsMockFns.mockGetOrgMemberUsageForCurrentPeriod,
}
organizationMemberLimitsMockFns.mockIsOrgMemberUsageLimitTarget.mockResolvedValue(true)
const mockGetOrganizationBillingData = billingOrganizationMockFns.mockGetOrganizationBillingData
const mockUpdateOrganizationUsageLimit = billingOrganizationMockFns.mockUpdateOrganizationUsageLimit
const mockIsOrganizationOwnerOrAdmin = billingOrganizationMockFns.mockIsOrganizationOwnerOrAdmin
const mockGetOrganizationSubscription = billingCoreMockFns.mockGetOrganizationSubscription

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
const session = createSessionPrincipal({ userId: 'actor', sessionId: 'session' })
function membership(role = 'admin') {
  queueTableRows(schemaMock.member, [{ role }])
}
beforeEach(() => {
  resetDbChainMock()
  setEnvFlags({ isHosted: true })
  mockIsOrganizationOwnerOrAdmin.mockResolvedValue(true)
  mocks.userUpdate.mockResolvedValue({ success: true })
  mockUpdateOrganizationUsageLimit.mockResolvedValue({ success: true })
  mockGetOrganizationBillingData.mockResolvedValue(null)
  mocks.userRead.mockResolvedValue({ limit: 20 })
  mocks.memberRead.mockResolvedValue(2)
  mocks.usage.mockResolvedValue(1)
  mockGetOrganizationSubscription.mockResolvedValue(null)
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
    expect(mockUpdateOrganizationUsageLimit).not.toHaveBeenCalled()
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
    expect(mockUpdateOrganizationUsageLimit).not.toHaveBeenCalled()
  })
  it('preserves plan/minimum failure messages without reading a success response', async () => {
    mockUpdateOrganizationUsageLimit.mockResolvedValue({
      success: false,
      error: 'Enterprise limits are fixed',
    })
    await expect(
      updateUsageLimit.execute({
        principal: session,
        input: { context: 'organization', organizationId: 'org', limit: 100 },
      })
    ).rejects.toMatchObject({ code: 'validation', message: 'Enterprise limits are fixed' })
    expect(mockGetOrganizationBillingData).not.toHaveBeenCalled()
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
