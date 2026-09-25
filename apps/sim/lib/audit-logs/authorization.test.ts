import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/billing/core/access', () => ({ isOrganizationBillingBlocked: vi.fn() }))
vi.mock('@/lib/billing/subscriptions/utils', () => ({ USABLE_SUBSCRIPTION_STATUSES: ['active'] }))

import { resolveDefaultAuditOrganization } from '@/lib/audit-logs/authorization'

describe('resolveDefaultAuditOrganization', () => {
  beforeEach(() => {
    resetDbChainMock()
  })

  it('resolves the single organization the actor belongs to', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ organizationId: 'organization-1' }])

    await expect(resolveDefaultAuditOrganization('user-1')).resolves.toEqual({
      kind: 'resolved',
      organizationId: 'organization-1',
    })
  })

  it('reports no organization when the actor holds no membership', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([])

    await expect(resolveDefaultAuditOrganization('user-1')).resolves.toEqual({ kind: 'none' })
  })
})
