/**
 * @vitest-environment node
 */
import { workflowAuthzMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PRIVATE_MODEL_INPUT_PROVENANCE_HEADER } from '@/lib/execution/model-input-provenance'
import {
  RESOLVED_SECRET_PROVENANCE_FIELD,
  RESOLVED_SECRET_PROVENANCE_METADATA_V1,
} from '@/lib/execution/private-tool-metadata'

const mocks = vi.hoisted(() => ({
  assertPermissionsAllowed: vi.fn(),
  authorizeCredential: vi.fn(),
  checkAttributedUsageLimits: vi.fn(),
  importProvenance: vi.fn(),
  isComplete: vi.fn(),
  prepareEnvironment: vi.fn(),
  requireBillingAttribution: vi.fn(),
  validateHallucination: vi.fn(),
  validateJson: vi.fn(),
  validatePIIViaHttp: vi.fn(),
  validateRegex: vi.fn(),
}))

vi.mock('@/lib/auth/credential-access', () => ({
  authorizeCredentialUseForAuth: mocks.authorizeCredential,
}))
vi.mock('@/lib/billing/core/billing-attribution', () => ({
  checkAttributedUsageLimits: mocks.checkAttributedUsageLimits,
  requireBillingAttributionHeader: mocks.requireBillingAttribution,
  toBillingContext: vi.fn(() => ({})),
}))
vi.mock('@/lib/billing/threshold-billing', () => ({
  checkAndBillPayerOverageThreshold: vi.fn(),
}))
vi.mock('@/lib/copilot/environment-context', () => ({
  prepareCopilotEnvironmentContext: mocks.prepareEnvironment,
}))
vi.mock('@/lib/guardrails/validate_hallucination', () => ({
  validateHallucination: mocks.validateHallucination,
}))
vi.mock('@/lib/guardrails/validate_json', () => ({ validateJson: mocks.validateJson }))
vi.mock('@/lib/guardrails/validate_regex', () => ({ validateRegex: mocks.validateRegex }))
vi.mock('@/lib/guardrails/validation-client', () => ({
  validatePIIViaHttp: mocks.validatePIIViaHttp,
}))
vi.mock('@/ee/access-control/utils/permission-check', () => ({
  assertPermissionsAllowed: mocks.assertPermissionsAllowed,
  ModelNotAllowedError: class ModelNotAllowedError extends Error {},
  ProviderNotAllowedError: class ProviderNotAllowedError extends Error {},
}))

import { executeGuardrailsValidation } from '@/lib/internal/guardrails/operations'

const BILLING_ATTRIBUTION = {
  actorUserId: 'user-1',
  workspaceId: 'workspace-1',
  billingEntity: { type: 'user' as const, id: 'user-1' },
}

describe('executeGuardrailsValidation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
      allowed: true,
      workflow: { id: 'workflow-1', workspaceId: 'workspace-1' },
    })
    mocks.requireBillingAttribution.mockReturnValue(BILLING_ATTRIBUTION)
    mocks.checkAttributedUsageLimits.mockResolvedValue({ isExceeded: false })
    mocks.importProvenance.mockResolvedValue({ success: true, matched: true })
    mocks.isComplete.mockReturnValue(true)
    mocks.prepareEnvironment.mockResolvedValue({
      resolvedSecretTraceRegistry: {
        importProvenanceForValueAtInputPath: mocks.importProvenance,
        isComplete: mocks.isComplete,
      },
    })
    mocks.authorizeCredential.mockResolvedValue({ ok: true })
    mocks.validateHallucination.mockResolvedValue({ passed: true, score: 8 })
    mocks.validateJson.mockReturnValue({ passed: true })
    mocks.validateRegex.mockReturnValue({ passed: true })
    mocks.validatePIIViaHttp.mockResolvedValue({ passed: true, detectedEntities: [] })
  })

  it('runs hallucination work once with authorized scope, billing, provenance, and signal', async () => {
    const controller = new AbortController()
    const provenance = { version: 1, complete: true, entries: [] }
    const headers = new Headers({
      'x-sim-billing-attribution': 'attribution',
      [PRIVATE_MODEL_INPUT_PROVENANCE_HEADER]: RESOLVED_SECRET_PROVENANCE_METADATA_V1,
    })
    const result = await executeGuardrailsValidation(
      {
        validationType: 'hallucination',
        input: 'claim',
        knowledgeBaseId: 'knowledge-1',
        model: 'gpt-4o',
        workflowId: 'workflow-1',
        [RESOLVED_SECRET_PROVENANCE_FIELD]: provenance,
      },
      {
        actorUserId: 'user-1',
        headers,
        requestId: 'request-1',
        signal: controller.signal,
      }
    )

    expect(result.output).toMatchObject({ passed: true, score: 8 })
    expect(workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission).toHaveBeenCalledWith({
      workflowId: 'workflow-1',
      userId: 'user-1',
      action: 'read',
    })
    expect(mocks.requireBillingAttribution).toHaveBeenCalledWith(headers, {
      actorUserId: 'user-1',
      workspaceId: 'workspace-1',
    })
    expect(mocks.importProvenance).toHaveBeenCalledWith(provenance, 'claim', ['input'], {
      trusted: true,
      origin: 'guardrailsTool.inputProvenance',
    })
    expect(mocks.validateHallucination).toHaveBeenCalledTimes(1)
    expect(mocks.validateHallucination).toHaveBeenCalledWith(
      expect.objectContaining({
        abortSignal: controller.signal,
        actorUserId: 'user-1',
        billingAttribution: BILLING_ATTRIBUTION,
        workspaceId: 'workspace-1',
      })
    )
  })

  it('keeps local validators outside protected hallucination admission', async () => {
    const result = await executeGuardrailsValidation(
      { validationType: 'regex', input: 'claim', regex: '^claim$' },
      {
        actorUserId: 'user-1',
        headers: new Headers(),
        requestId: 'request-1',
      }
    )

    expect(result.output.passed).toBe(true)
    expect(mocks.validateRegex).toHaveBeenCalledOnce()
    expect(workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission).not.toHaveBeenCalled()
    expect(mocks.requireBillingAttribution).not.toHaveBeenCalled()
  })

  it('routes PII validation through the app-container capability boundary', async () => {
    const controller = new AbortController()

    const result = await executeGuardrailsValidation(
      {
        validationType: 'pii',
        input: 'email a@b.com',
        piiEntityTypes: ['EMAIL_ADDRESS'],
        piiMode: 'mask',
        piiLanguage: 'en',
      },
      {
        actorUserId: 'user-1',
        headers: new Headers(),
        requestId: 'request-1',
        signal: controller.signal,
      }
    )

    expect(result.output.passed).toBe(true)
    expect(mocks.validatePIIViaHttp).toHaveBeenCalledWith(
      {
        text: 'email a@b.com',
        entityTypes: ['EMAIL_ADDRESS'],
        mode: 'mask',
        language: 'en',
        customPatterns: undefined,
      },
      controller.signal
    )
  })

  it('preserves PII verdict metadata when the capability fails', async () => {
    mocks.validatePIIViaHttp.mockRejectedValueOnce(new Error('capability unavailable'))

    const result = await executeGuardrailsValidation(
      {
        validationType: 'pii',
        input: 'email a@b.com',
      },
      {
        actorUserId: 'user-1',
        headers: new Headers(),
        requestId: 'request-1',
      }
    )

    expect(result.output).toMatchObject({
      passed: false,
      validationType: 'pii',
      input: 'email a@b.com',
      error: 'PII validation failed: capability unavailable',
      detectedEntities: [],
    })
  })

  it('conceals inaccessible workflow validation as a failed verdict without provider work', async () => {
    workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValueOnce({
      allowed: false,
      message: 'Workflow not found or access denied.',
    })

    const result = await executeGuardrailsValidation(
      {
        validationType: 'hallucination',
        input: 'claim',
        knowledgeBaseId: 'knowledge-1',
        model: 'gpt-4o',
        workflowId: 'workflow-1',
      },
      {
        actorUserId: 'user-1',
        headers: new Headers(),
        requestId: 'request-1',
      }
    )

    expect(result.output).toMatchObject({
      passed: false,
      error: 'Workflow not found or access denied.',
    })
    expect(mocks.validateHallucination).not.toHaveBeenCalled()
  })

  it('does not conceal cancellation during hallucination authorization', async () => {
    const controller = new AbortController()
    const abortError = new DOMException('Operation aborted', 'AbortError')
    workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission.mockImplementationOnce(
      async () => {
        controller.abort()
        throw abortError
      }
    )

    await expect(
      executeGuardrailsValidation(
        {
          validationType: 'hallucination',
          input: 'claim',
          knowledgeBaseId: 'knowledge-1',
          model: 'gpt-4o',
          workflowId: 'workflow-1',
        },
        {
          actorUserId: 'user-1',
          headers: new Headers(),
          requestId: 'request-1',
          signal: controller.signal,
        }
      )
    ).rejects.toBe(abortError)
    expect(mocks.validateHallucination).not.toHaveBeenCalled()
  })
})
