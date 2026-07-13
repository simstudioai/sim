/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetOrganizationBillingData, mockGetSession, mockIsOrganizationOwnerOrAdmin } =
  vi.hoisted(() => ({
    mockGetOrganizationBillingData: vi.fn(),
    mockGetSession: vi.fn(),
    mockIsOrganizationOwnerOrAdmin: vi.fn(),
  }))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
  getSession: mockGetSession,
}))

vi.mock('@/lib/billing', () => ({
  getUserUsageLimitInfo: vi.fn(),
  updateUserUsageLimit: vi.fn(),
}))

vi.mock('@/lib/billing/core/organization', () => ({
  getOrganizationBillingData: mockGetOrganizationBillingData,
  isOrganizationOwnerOrAdmin: mockIsOrganizationOwnerOrAdmin,
}))

import { GET } from '@/app/api/usage/route'

describe('GET /api/usage organization context', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'member-1' } })
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
