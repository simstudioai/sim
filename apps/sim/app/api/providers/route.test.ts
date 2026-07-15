/**
 * @vitest-environment node
 */
import { createMockRequest, hybridAuthMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockExecuteProviderRequest,
  mockRequireBillingAttributionHeader,
  mockCheckWorkspaceAccess,
  mockAuthorizeCredentialUse,
} = vi.hoisted(() => ({
  mockExecuteProviderRequest: vi.fn(),
  mockRequireBillingAttributionHeader: vi.fn(),
  mockCheckWorkspaceAccess: vi.fn(),
  mockAuthorizeCredentialUse: vi.fn(),
}))

vi.mock('@/providers', () => ({
  executeProviderRequest: mockExecuteProviderRequest,
}))

vi.mock('@/lib/billing/core/billing-attribution', () => ({
  BILLING_ATTRIBUTION_HEADER: 'x-sim-billing-attribution',
  requireBillingAttributionHeader: mockRequireBillingAttributionHeader,
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  checkWorkspaceAccess: mockCheckWorkspaceAccess,
}))

vi.mock('@/lib/auth/credential-access', () => ({
  authorizeCredentialUse: mockAuthorizeCredentialUse,
}))

vi.mock('@/app/api/auth/oauth/utils', () => ({
  getServiceAccountToken: vi.fn(),
  refreshTokenIfNeeded: vi.fn(),
  resolveOAuthAccountId: vi.fn(),
}))

vi.mock('@/ee/access-control/utils/permission-check', () => ({
  assertPermissionsAllowed: vi.fn(),
  IntegrationNotAllowedError: class IntegrationNotAllowedError extends Error {},
  ModelNotAllowedError: class ModelNotAllowedError extends Error {},
  ProviderNotAllowedError: class ProviderNotAllowedError extends Error {},
}))

import { POST } from '@/app/api/providers/route'

const BILLING_ATTRIBUTION = {
  actorUserId: 'user-1',
  workspaceId: 'ws-1',
  organizationId: 'org-1',
  billedAccountUserId: 'owner-1',
  billingEntity: { type: 'organization', id: 'org-1' },
  billingPeriod: {
    start: '2026-07-01T00:00:00.000Z',
    end: '2026-08-01T00:00:00.000Z',
  },
  payerSubscription: null,
}

describe('POST /api/providers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hybridAuthMockFns.mockCheckInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-1',
      authType: 'internal_jwt',
    })
    mockCheckWorkspaceAccess.mockResolvedValue({ hasAccess: true })
    mockRequireBillingAttributionHeader.mockReturnValue(BILLING_ATTRIBUTION)
    mockExecuteProviderRequest.mockResolvedValue({
      content: 'hello',
      model: 'gpt-4o',
      tokens: { input: 1, output: 1, total: 2 },
    })
  })

  it('validates the attribution header and forwards it to executeProviderRequest', async () => {
    const res = await POST(
      createMockRequest(
        'POST',
        { provider: 'openai', model: 'gpt-4o', workspaceId: 'ws-1' },
        { 'x-sim-billing-attribution': 'encoded-attribution' }
      )
    )

    expect(res.status).toBe(200)
    expect(mockRequireBillingAttributionHeader).toHaveBeenCalledWith(expect.anything(), {
      actorUserId: 'user-1',
      workspaceId: 'ws-1',
    })
    expect(mockExecuteProviderRequest).toHaveBeenCalledWith(
      'openai',
      expect.objectContaining({ billingAttribution: BILLING_ATTRIBUTION })
    )
  })

  it('executes without attribution when the header is absent', async () => {
    const res = await POST(
      createMockRequest('POST', { provider: 'openai', model: 'gpt-4o', workspaceId: 'ws-1' })
    )

    expect(res.status).toBe(200)
    expect(mockRequireBillingAttributionHeader).not.toHaveBeenCalled()
    expect(mockExecuteProviderRequest).toHaveBeenCalledWith(
      'openai',
      expect.objectContaining({ billingAttribution: undefined })
    )
  })

  it('rejects an attribution header when the body has no workspaceId to validate against', async () => {
    const res = await POST(
      createMockRequest(
        'POST',
        { provider: 'openai', model: 'gpt-4o' },
        { 'x-sim-billing-attribution': 'encoded-attribution' }
      )
    )

    expect(res.status).toBe(400)
    expect(mockRequireBillingAttributionHeader).not.toHaveBeenCalled()
    expect(mockExecuteProviderRequest).not.toHaveBeenCalled()
  })

  it('rejects with 400 when the attribution header does not match the authenticated scope', async () => {
    mockRequireBillingAttributionHeader.mockImplementation(() => {
      throw new Error('Billing attribution header does not match the authenticated request scope')
    })

    const res = await POST(
      createMockRequest(
        'POST',
        { provider: 'openai', model: 'gpt-4o', workspaceId: 'ws-1' },
        { 'x-sim-billing-attribution': 'encoded-attribution' }
      )
    )

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe(
      'Billing attribution header does not match the authenticated request scope'
    )
    expect(mockExecuteProviderRequest).not.toHaveBeenCalled()
  })
})
