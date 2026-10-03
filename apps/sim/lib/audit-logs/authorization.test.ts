import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { billingAccessMock } from '@sim/testing/mocks/billing-access.mock'
import { billingSubscriptionUtilsMock } from '@sim/testing/mocks/billing-subscription-utils.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/billing/core/access', () => billingAccessMock)
vi.mock('@/lib/billing/subscriptions/utils', () => billingSubscriptionUtilsMock)

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
