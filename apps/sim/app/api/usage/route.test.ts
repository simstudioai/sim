import { authMockFns, createMockRequest } from '@sim/testing'
import {
  billingOrganizationMock,
  billingOrganizationMockFns,
} from '@sim/testing/mocks/billing-organization.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/billing', () => ({
  getUserUsageLimitInfo: vi.fn(),
  updateUserUsageLimit: vi.fn(),
}))

vi.mock('@/lib/billing/core/organization', () => billingOrganizationMock)

import { GET } from '@/app/api/usage/route'

const { mockGetOrganizationBillingData, mockIsOrganizationOwnerOrAdmin } =
  billingOrganizationMockFns

const mockGetSession = authMockFns.mockGetSession

describe('GET /api/usage organization context', () => {
  beforeEach(() => {
    mockGetSession.mockResolvedValue({ user: { id: 'member-1' }, session: { id: 'session' } })
  })

  it('rejects ordinary members before loading organization usage data', async () => {
    mockIsOrganizationOwnerOrAdmin.mockResolvedValue(false)

    const response = await GET(
      createMockRequest(
        'GET',
        undefined,
        {},
        'http://localhost:3000/api/usage?context=organization&organizationId=org-1'
      )
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Permission denied' })
    expect(mockGetOrganizationBillingData).not.toHaveBeenCalled()
  })
})
