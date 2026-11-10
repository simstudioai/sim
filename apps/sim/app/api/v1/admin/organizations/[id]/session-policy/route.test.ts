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
vi.mock('@/lib/auth/session-policy', () => ({
  eagerClampOrgSessions: vi.fn(),
  invalidateSessionPolicyCache: vi.fn(),
}))
vi.mock('@/lib/auth/security-policy', () => ({
  invalidateSecurityPolicyVersionCache: vi.fn(),
}))
vi.mock('@sim/audit', () => auditMock)

import { PATCH } from '@/app/api/v1/admin/organizations/[id]/session-policy/route'

describe('admin organization session-policy PATCH', () => {
  beforeEach(() => {
    resetDbChainMock()
    mockAuthenticateAdminRequest.mockReturnValue({ authenticated: true })
    billingSubscriptionMockFns.mockIsOrganizationFeatureEntitled.mockResolvedValueOnce(true)
  })

  it('refuses a personal organization with 409 before writing', async () => {
    queueTableRows(schemaMock.organization, [{ name: 'Personal', kind: 'personal' }])

    const response = await PATCH(
      createMockRequest(
        'PATCH',
        { maxSessionHours: 72, idleTimeoutHours: 48 },
        {},
        'http://localhost:3000/api/v1/admin/organizations/org-1/session-policy'
      ),
      createRouteContext({ id: 'org-1' })
    )

    expect(response.status).toBe(409)
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })
})
