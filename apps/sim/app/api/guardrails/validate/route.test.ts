/**
 * @vitest-environment node
 */
import { createMockRequest, hybridAuthMockFns, workflowAuthzMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockAuthorizeCredentialUse, mockCheckActorUsageLimits, mockValidateHallucination } =
  vi.hoisted(() => ({
    mockAuthorizeCredentialUse: vi.fn(),
    mockCheckActorUsageLimits: vi.fn(),
    mockValidateHallucination: vi.fn(),
  }))

vi.mock('@/lib/auth/credential-access', () => ({
  authorizeCredentialUse: mockAuthorizeCredentialUse,
}))

vi.mock('@/lib/billing/calculations/usage-monitor', () => ({
  checkActorUsageLimits: mockCheckActorUsageLimits,
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
})
