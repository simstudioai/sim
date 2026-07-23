/**
 * @vitest-environment node
 */
import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockIsOrganizationBillingBlocked } = vi.hoisted(() => ({
  mockIsOrganizationBillingBlocked: vi.fn(),
}))

vi.mock('@/lib/billing/core/access', () => ({
  isOrganizationBillingBlocked: mockIsOrganizationBillingBlocked,
}))

import { validateEnterpriseAuditAccess } from '@/app/api/v1/audit-logs/auth'

describe('enterprise audit access', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockIsOrganizationBillingBlocked.mockResolvedValue(false)
    queueTableRows(schemaMock.member, [{ organizationId: 'organization-route', role: 'admin' }])
    queueTableRows(schemaMock.subscription, [{ id: 'subscription-1' }])
    queueTableRows(schemaMock.member, [{ userId: 'viewer' }, { userId: 'member-2' }])
  })

  afterAll(() => {
    resetDbChainMock()
  })

  it('authorizes and bills against the organization named by the route', async () => {
    await expect(validateEnterpriseAuditAccess('viewer', 'organization-route')).resolves.toEqual({
      success: true,
      context: {
        organizationId: 'organization-route',
        orgMemberIds: ['viewer', 'member-2'],
      },
    })
    expect(dbChainMockFns.where).toHaveBeenNthCalledWith(1, {
      type: 'and',
      conditions: [
        { type: 'eq', left: schemaMock.member.userId, right: 'viewer' },
        { type: 'eq', left: schemaMock.member.organizationId, right: 'organization-route' },
      ],
    })
    expect(mockIsOrganizationBillingBlocked).toHaveBeenCalledWith('organization-route')
  })
})
