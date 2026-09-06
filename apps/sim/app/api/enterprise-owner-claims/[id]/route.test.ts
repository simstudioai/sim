/**
 * @vitest-environment node
 */
import { authMockFns, createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  acceptClaim: vi.fn(),
  getClaimDetails: vi.fn(),
}))

vi.mock('@/lib/billing/enterprise-owner-claim', () => ({
  acceptEnterpriseOwnerClaim: mocks.acceptClaim,
  getEnterpriseOwnerClaimDetails: mocks.getClaimDetails,
  EnterpriseOwnerClaimEmailMismatchError: class EnterpriseOwnerClaimEmailMismatchError extends Error {},
  EnterpriseOwnerClaimWorkspaceLimitError: class EnterpriseOwnerClaimWorkspaceLimitError extends Error {},
}))

vi.mock('@/lib/billing/enterprise-provisioning', () => ({
  EnterpriseProvisioningError: class EnterpriseProvisioningError extends Error {},
}))

import { POST } from '@/app/api/enterprise-owner-claims/[id]/accept/route'
import { GET } from '@/app/api/enterprise-owner-claims/[id]/route'

const claim = {
  id: 'claim-1',
  ownerEmail: 'owner@example.com',
  organizationName: 'Acme',
  organizationId: null,
  provisioningOperationId: null,
  stage: 'owner_acceptance' as const,
  status: 'awaiting_owner' as const,
  error: null,
  expiresAt: '2026-09-04T00:00:00.000Z',
  createdAt: '2026-08-28T00:00:00.000Z',
  updatedAt: '2026-08-28T00:00:00.000Z',
}

describe('Enterprise owner claim routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMockFns.mockGetSession.mockResolvedValue({
      user: {
        id: 'owner-1',
        name: 'Owner',
        email: 'owner@example.com',
        emailVerified: false,
      },
    })
  })

  it('lets the invited account review the mailed claim before email verification', async () => {
    mocks.getClaimDetails.mockResolvedValue({
      ...claim,
      invoiceAmountUsd: 10_000,
      billingInterval: 'year',
      seats: 10,
      invitations: 0,
      workspacePreview: { workspacesToMove: [], createsDefaultWorkspace: true },
      acceptanceReview: { canAccept: true, reason: null, requiredSeats: 1 },
    })

    const response = await GET(
      createMockRequest(
        'GET',
        undefined,
        {},
        'http://localhost/api/enterprise-owner-claims/claim-1?token=secure-token'
      ),
      { params: Promise.resolve({ id: 'claim-1' }) }
    )

    expect(response.status).toBe(200)
    expect(mocks.getClaimDetails).toHaveBeenCalledWith({
      claimId: 'claim-1',
      token: 'secure-token',
      userId: 'owner-1',
      userEmail: 'owner@example.com',
    })
  })

  it('lets the acceptance transaction verify an unverified invited account', async () => {
    mocks.acceptClaim.mockResolvedValue({
      success: true,
      claim,
      redirectPath: '/home',
    })

    const response = await POST(
      createMockRequest(
        'POST',
        {
          token: 'secure-token',
          disclosedWorkspaceIds: [],
          disclosedCreatesDefaultWorkspace: true,
        },
        {},
        'http://localhost/api/enterprise-owner-claims/claim-1/accept'
      ),
      { params: Promise.resolve({ id: 'claim-1' }) }
    )

    expect(response.status).toBe(200)
    expect(mocks.acceptClaim).toHaveBeenCalledWith({
      claimId: 'claim-1',
      token: 'secure-token',
      userId: 'owner-1',
      userEmail: 'owner@example.com',
      userName: 'Owner',
      disclosedWorkspaceIds: [],
      disclosedCreatesDefaultWorkspace: true,
    })
  })
})
