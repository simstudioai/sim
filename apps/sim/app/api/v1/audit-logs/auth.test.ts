/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockIsOrganizationBillingBlocked,
  mockMemberWhere,
  mockMembersWhere,
  mockSelect,
  mockSubscriptionWhere,
} = vi.hoisted(() => ({
  mockIsOrganizationBillingBlocked: vi.fn(),
  mockMemberWhere: vi.fn(),
  mockMembersWhere: vi.fn(),
  mockSelect: vi.fn(),
  mockSubscriptionWhere: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: { select: mockSelect },
}))

vi.mock('@sim/db/schema', () => ({
  member: {
    organizationId: 'member.organizationId',
    role: 'member.role',
    userId: 'member.userId',
  },
  subscription: {
    id: 'subscription.id',
    plan: 'subscription.plan',
    referenceId: 'subscription.referenceId',
    status: 'subscription.status',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => ({ type: 'and', conditions })),
  eq: vi.fn((left: unknown, right: unknown) => ({ type: 'eq', left, right })),
  inArray: vi.fn((left: unknown, right: unknown) => ({ type: 'inArray', left, right })),
}))

vi.mock('@/lib/billing/core/access', () => ({
  isOrganizationBillingBlocked: mockIsOrganizationBillingBlocked,
}))

import { validateEnterpriseAuditAccess } from '@/app/api/v1/audit-logs/auth'

describe('enterprise audit access', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsOrganizationBillingBlocked.mockResolvedValue(false)
    mockMemberWhere.mockReturnValue({
      limit: vi.fn().mockResolvedValue([{ organizationId: 'organization-route', role: 'admin' }]),
    })
    mockSubscriptionWhere.mockReturnValue({
      limit: vi.fn().mockResolvedValue([{ id: 'subscription-1' }]),
    })
    mockMembersWhere.mockResolvedValue([{ userId: 'viewer' }, { userId: 'member-2' }])
    mockSelect
      .mockReturnValueOnce({ from: () => ({ where: mockMemberWhere }) })
      .mockReturnValueOnce({ from: () => ({ where: mockSubscriptionWhere }) })
      .mockReturnValueOnce({ from: () => ({ where: mockMembersWhere }) })
  })

  it('authorizes and bills against the organization named by the route', async () => {
    await expect(validateEnterpriseAuditAccess('viewer', 'organization-route')).resolves.toEqual({
      success: true,
      context: {
        organizationId: 'organization-route',
        orgMemberIds: ['viewer', 'member-2'],
      },
    })
    expect(mockMemberWhere).toHaveBeenCalledWith({
      type: 'and',
      conditions: [
        { type: 'eq', left: 'member.userId', right: 'viewer' },
        { type: 'eq', left: 'member.organizationId', right: 'organization-route' },
      ],
    })
    expect(mockIsOrganizationBillingBlocked).toHaveBeenCalledWith('organization-route')
  })
})
