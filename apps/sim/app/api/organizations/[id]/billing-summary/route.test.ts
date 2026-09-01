/**
 * @vitest-environment node
 */
import { authMockFns, createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ForbiddenOperationError } from '@/lib/core/application'

const { mockReadBillingSummary } = vi.hoisted(() => ({
  mockReadBillingSummary: vi.fn(),
}))

vi.mock(
  '@/lib/billing/application/organization-billing-summary/get-organization-billing-summary',
  () => ({
    getOrganizationBillingSummary: {
      operation: { id: 'organization_billing.summary.read' },
      execute: mockReadBillingSummary,
    },
  })
)

import { GET } from '@/app/api/organizations/[id]/billing-summary/route'

const routeContext = { params: Promise.resolve({ id: 'organization-1' }) }
const summary = {
  organizationId: 'organization-1',
  subscriptionState: 'active' as const,
  subscriptionPlan: 'team',
  subscriptionStatus: 'active',
  creditBalance: 10,
  billingInterval: 'month' as const,
  cancelAtPeriodEnd: false,
  totalSeats: 3,
  totalCurrentUsage: 25,
  totalUsageLimit: 100,
  minimumBillingAmount: 60,
  billingPeriodEnd: '2026-09-30T00:00:00.000Z',
  billingBlocked: false,
  billingBlockedReason: null,
  blockedByOrgOwner: false,
  upgradeWorkspaceId: 'workspace-1',
  userRole: 'admin' as const,
}

describe('GET /api/organizations/[id]/billing-summary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: 'user-1' },
      session: { id: 'session-1' },
    })
    mockReadBillingSummary.mockResolvedValue(summary)
  })

  it('rejects an unauthenticated request before the protected read runs', async () => {
    authMockFns.mockGetSession.mockResolvedValue(null)

    const response = await GET(createMockRequest('GET'), routeContext)

    expect(response.status).toBe(401)
    expect(mockReadBillingSummary).not.toHaveBeenCalled()
  })

  it('projects an authorization refusal without exposing billing data', async () => {
    mockReadBillingSummary.mockRejectedValue(
      new ForbiddenOperationError(
        'ORGANIZATION_ADMIN_REQUIRED',
        'Organization admin or owner authority is required to read billing information'
      )
    )

    const response = await GET(createMockRequest('GET'), routeContext)

    expect(response.status).toBe(403)
    const body = await response.json()
    expect(body).toEqual({
      error: 'Organization admin or owner authority is required to read billing information',
    })
    expect(body).not.toHaveProperty('data')
  })

  it('maps the authenticated viewer and route organization into the semantic read', async () => {
    const response = await GET(createMockRequest('GET'), routeContext)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ success: true, data: summary })
    expect(mockReadBillingSummary).toHaveBeenCalledWith(
      expect.objectContaining({
        principal: {
          kind: 'session',
          userId: 'user-1',
          sessionId: 'session-1',
        },
        input: { organizationId: 'organization-1' },
      })
    )
  })
})
