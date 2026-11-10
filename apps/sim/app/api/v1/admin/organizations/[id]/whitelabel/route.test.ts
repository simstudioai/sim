import {
  createMockRequest,
  dbChainMockFns,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { createRouteContext } from '@sim/testing/helpers/http'
import { auditMock } from '@sim/testing/mocks/audit.mock'
import {
  billingSubscriptionMock,
  billingSubscriptionMockFns,
} from '@sim/testing/mocks/billing-subscription.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockAuthenticateAdminRequest } = vi.hoisted(() => ({
  mockAuthenticateAdminRequest: vi.fn(),
}))

vi.mock('@/app/api/v1/admin/auth', () => ({
  authenticateAdminRequest: mockAuthenticateAdminRequest,
}))
vi.mock('@/lib/billing/core/subscription', () => billingSubscriptionMock)
vi.mock('@sim/audit', () => auditMock)

import { PATCH } from '@/app/api/v1/admin/organizations/[id]/whitelabel/route'

describe('admin organization whitelabel PATCH', () => {
  beforeEach(() => {
    resetDbChainMock()
    mockAuthenticateAdminRequest.mockReturnValue({ authenticated: true })
    billingSubscriptionMockFns.mockIsOrganizationFeatureEntitled.mockResolvedValueOnce(true)
  })

  it('refuses a personal organization with 409 before writing', async () => {
    queueTableRows(schemaMock.organization, [
      { name: 'Personal', kind: 'personal', whitelabelSettings: null },
    ])

    const response = await PATCH(
      createMockRequest(
        'PATCH',
        { brandName: 'Acme' },
        {},
        'http://localhost:3000/api/v1/admin/organizations/org-1/whitelabel'
      ),
      createRouteContext({ id: 'org-1' })
    )

    expect(response.status).toBe(409)
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })
})
