/**
 * @vitest-environment node
 */
import { createMockRequest, hybridAuthMockFns, workflowAuthzMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAuthorizeCredentialUse,
  mockCheckActorUsageLimits,
  mockCheckAttributedUsageLimits,
  mockRequireBillingAttributionHeader,
  mockResolveBillingAttribution,
  mockSerializeBillingAttributionHeader,
  mockToBillingContext,
  mockValidateHallucination,
  mockRecordUsage,
  mockCheckAndBillPayerOverageThreshold,
} = vi.hoisted(() => ({
  mockAuthorizeCredentialUse: vi.fn(),
  mockCheckActorUsageLimits: vi.fn(),
  mockCheckAttributedUsageLimits: vi.fn(),
  mockRequireBillingAttributionHeader: vi.fn(),
  mockResolveBillingAttribution: vi.fn(),
  mockSerializeBillingAttributionHeader: vi.fn(),
  mockToBillingContext: vi.fn(),
  mockValidateHallucination: vi.fn(),
  mockRecordUsage: vi.fn(),
  mockCheckAndBillPayerOverageThreshold: vi.fn(),
}))

vi.mock('@/lib/auth/credential-access', () => ({
  authorizeCredentialUse: mockAuthorizeCredentialUse,
}))

vi.mock('@/lib/billing/calculations/usage-monitor', () => ({
  checkActorUsageLimits: mockCheckActorUsageLimits,
}))

vi.mock('@/lib/billing/core/billing-attribution', () => ({
  checkAttributedUsageLimits: mockCheckAttributedUsageLimits,
  requireBillingAttributionHeader: mockRequireBillingAttributionHeader,
  resolveBillingAttribution: mockResolveBillingAttribution,
  serializeBillingAttributionHeader: mockSerializeBillingAttributionHeader,
  toBillingContext: mockToBillingContext,
}))

vi.mock('@/lib/billing/core/usage-log', () => ({
  recordUsage: mockRecordUsage,
}))

vi.mock('@/lib/billing/threshold-billing', () => ({
  checkAndBillPayerOverageThreshold: mockCheckAndBillPayerOverageThreshold,
}))

vi.mock('@/lib/guardrails/validate_hallucination', () => ({
  validateHallucination: mockValidateHallucination,
}))

vi.mock('@/lib/guardrails/validate_json', () => ({
  validateJson: vi.fn(() => ({ passed: true })),
}))

vi.mock('@/lib/guardrails/validate_pii', () => ({
  validatePII: vi.fn(() => ({ passed: true })),
}))

vi.mock('@/lib/guardrails/validate_regex', () => ({
  validateRegex: vi.fn(() => ({ passed: true })),
}))

vi.mock('@/ee/access-control/utils/permission-check', () => ({
  assertPermissionsAllowed: vi.fn(),
  ModelNotAllowedError: class ModelNotAllowedError extends Error {},
  ProviderNotAllowedError: class ProviderNotAllowedError extends Error {},
}))

import { POST } from '@/app/api/guardrails/validate/route'

describe('POST /api/guardrails/validate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-1',
      authType: 'session',
    })
    workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
      allowed: true,
      workflow: { id: 'wf-1', workspaceId: 'ws-1' },
    })
    mockCheckActorUsageLimits.mockResolvedValue({ isExceeded: false })
    mockCheckAttributedUsageLimits.mockResolvedValue({ isExceeded: false })
    mockResolveBillingAttribution.mockResolvedValue({
      actorUserId: 'user-1',
      workspaceId: 'ws-1',
      billingEntity: { type: 'organization', id: 'org-1' },
    })
    mockRequireBillingAttributionHeader.mockReturnValue({
      actorUserId: 'user-1',
      workspaceId: 'ws-1',
      billingEntity: { type: 'organization', id: 'org-1' },
    })
    mockSerializeBillingAttributionHeader.mockReturnValue('serialized-attribution')
    mockToBillingContext.mockReturnValue({
      billingEntity: { type: 'organization', id: 'org-1' },
      billingPeriod: {
        start: new Date('2026-07-01T00:00:00.000Z'),
        end: new Date('2026-08-01T00:00:00.000Z'),
      },
    })
    mockValidateHallucination.mockResolvedValue({ passed: true, score: 8 })
  })

  it('rejects a vertexCredential the caller does not have access to before calling validateHallucination', async () => {
    mockAuthorizeCredentialUse.mockResolvedValue({
      ok: false,
      error: 'You do not have access to this credential.',
    })

    const res = await POST(
      createMockRequest('POST', {
        validationType: 'hallucination',
        input: 'test input',
        knowledgeBaseId: 'kb-1',
        model: 'vertex/gemini-2.5-pro',
        workflowId: 'wf-1',
        vertexCredential: 'someone-elses-account-id',
      })
    )

    expect(res.status).toBe(401)
    expect(mockAuthorizeCredentialUse).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        credentialId: 'someone-elses-account-id',
        workflowId: 'wf-1',
        requireWorkflowIdForInternal: false,
      })
    )
    expect(mockValidateHallucination).not.toHaveBeenCalled()
  })

  it('proceeds with hallucination validation when the caller has access to the vertexCredential', async () => {
    mockAuthorizeCredentialUse.mockResolvedValue({ ok: true })

    const res = await POST(
      createMockRequest('POST', {
        validationType: 'hallucination',
        input: 'test input',
        knowledgeBaseId: 'kb-1',
        model: 'vertex/gemini-2.5-pro',
        workflowId: 'wf-1',
        vertexCredential: 'my-own-account-id',
      })
    )

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.output.passed).toBe(true)
    expect(mockAuthorizeCredentialUse).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ credentialId: 'my-own-account-id' })
    )
    expect(mockValidateHallucination).toHaveBeenCalled()
  })

  it('does not gate on vertexCredential for non-hallucination validation types', async () => {
    const res = await POST(
      createMockRequest('POST', {
        validationType: 'json',
        input: '{"a":1}',
      })
    )

    expect(res.status).toBe(200)
    expect(mockAuthorizeCredentialUse).not.toHaveBeenCalled()
  })

  it('does not gate hallucination validation when no vertexCredential is supplied', async () => {
    const res = await POST(
      createMockRequest('POST', {
        validationType: 'hallucination',
        input: 'test input',
        knowledgeBaseId: 'kb-1',
        model: 'gpt-4o',
        workflowId: 'wf-1',
      })
    )

    expect(res.status).toBe(200)
    expect(mockAuthorizeCredentialUse).not.toHaveBeenCalled()
    expect(mockValidateHallucination).toHaveBeenCalled()
  })

  it('does not gate on a leftover vertexCredential when the resolved model is not vertex', async () => {
    const res = await POST(
      createMockRequest('POST', {
        validationType: 'hallucination',
        input: 'test input',
        knowledgeBaseId: 'kb-1',
        model: 'gpt-4o',
        workflowId: 'wf-1',
        vertexCredential: 'someone-elses-account-id',
      })
    )

    expect(res.status).toBe(200)
    expect(mockAuthorizeCredentialUse).not.toHaveBeenCalled()
    expect(mockValidateHallucination).toHaveBeenCalled()
  })

  it('bills a hosted hallucination check against the exact workspace payer', async () => {
    mockValidateHallucination.mockResolvedValue({ passed: true, score: 8, cost: 0.01 })

    const res = await POST(
      createMockRequest('POST', {
        validationType: 'hallucination',
        input: 'test input',
        knowledgeBaseId: 'kb-1',
        model: 'gpt-4o',
        workflowId: 'wf-1',
      })
    )

    expect(res.status).toBe(200)
    expect(mockRecordUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        workspaceId: 'ws-1',
        billingEntity: { type: 'organization', id: 'org-1' },
      })
    )
    expect(mockCheckAndBillPayerOverageThreshold).toHaveBeenCalledWith({
      type: 'organization',
      id: 'org-1',
    })
  })

  it('requires and forwards immutable attribution for internal hallucination checks', async () => {
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-1',
      authType: 'internal_jwt',
    })

    const request = createMockRequest('POST', {
      validationType: 'hallucination',
      input: 'test input',
      knowledgeBaseId: 'kb-1',
      model: 'gpt-4o',
      workflowId: 'wf-1',
    })
    const res = await POST(request)

    expect(res.status).toBe(200)
    expect(mockRequireBillingAttributionHeader).toHaveBeenCalledWith(request.headers, {
      actorUserId: 'user-1',
      workspaceId: 'ws-1',
    })
    expect(mockResolveBillingAttribution).not.toHaveBeenCalled()
    expect(mockValidateHallucination).toHaveBeenCalledWith(
      expect.objectContaining({
        authHeaders: expect.objectContaining({
          billingAttribution: 'serialized-attribution',
        }),
      })
    )
  })
})
