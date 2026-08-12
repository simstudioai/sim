/**
 * @vitest-environment node
 */
import { createMockRequest, hybridAuthMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PRIVATE_MODEL_INPUT_STATE_HEADER,
  PROJECTED_MODEL_INPUT_PATHS_V1,
} from '@/lib/execution/model-input-provenance'

const {
  mockExecuteProviderRequest,
  mockRequireBillingAttributionHeader,
  mockCheckWorkspaceAccess,
  mockAuthorizeCredentialUse,
  mockPrepareCopilotEnvironmentContext,
  mockImportProvenance,
  mockRegistryIsComplete,
  mockProjectResolvedSecretModelContent,
} = vi.hoisted(() => ({
  mockExecuteProviderRequest: vi.fn(),
  mockRequireBillingAttributionHeader: vi.fn(),
  mockCheckWorkspaceAccess: vi.fn(),
  mockAuthorizeCredentialUse: vi.fn(),
  mockPrepareCopilotEnvironmentContext: vi.fn(),
  mockImportProvenance: vi.fn(),
  mockRegistryIsComplete: vi.fn(),
  mockProjectResolvedSecretModelContent: vi.fn(),
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

vi.mock('@/lib/copilot/environment-context', () => ({
  prepareCopilotEnvironmentContext: mockPrepareCopilotEnvironmentContext,
}))

vi.mock('@/executor/utils/resolved-secret-content-projection', () => ({
  projectResolvedSecretModelContent: mockProjectResolvedSecretModelContent,
}))

vi.mock('@/lib/oauth/credential-service', () => ({
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

function createProviderRequest(
  body: Record<string, unknown>,
  headers: Record<string, string> = {}
) {
  return createMockRequest(
    'POST',
    {
      ...body,
      __resolvedSecretTraceProvenance: { version: 1, complete: true, entries: [] },
    },
    {
      'x-sim-private-model-input-provenance': 'resolved-secret-provenance-v1',
      [PRIVATE_MODEL_INPUT_STATE_HEADER]: PROJECTED_MODEL_INPUT_PATHS_V1,
      ...headers,
    }
  )
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
    mockImportProvenance.mockResolvedValue(true)
    mockRegistryIsComplete.mockReturnValue(true)
    mockProjectResolvedSecretModelContent.mockImplementation((value) => ({
      safe: true,
      value,
    }))
    mockPrepareCopilotEnvironmentContext.mockResolvedValue({
      resolvedSecretTraceRegistry: {
        importProvenance: mockImportProvenance,
        isComplete: mockRegistryIsComplete,
      },
    })
  })

  it('validates the attribution header and forwards it to executeProviderRequest', async () => {
    const res = await POST(
      createProviderRequest(
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
      expect.objectContaining({ billingAttribution: BILLING_ATTRIBUTION }),
      expect.objectContaining({
        resolvedSecretTraceRegistry: expect.anything(),
      })
    )
  })

  it('executes without attribution when the header is absent', async () => {
    const res = await POST(
      createProviderRequest({ provider: 'openai', model: 'gpt-4o', workspaceId: 'ws-1' })
    )

    expect(res.status).toBe(200)
    expect(mockRequireBillingAttributionHeader).not.toHaveBeenCalled()
    expect(mockExecuteProviderRequest).toHaveBeenCalledWith(
      'openai',
      expect.objectContaining({ billingAttribution: undefined }),
      expect.objectContaining({
        resolvedSecretTraceRegistry: expect.anything(),
      })
    )
  })

  it('passes caller environment values and model-egress context to the provider boundary', async () => {
    const res = await POST(
      createProviderRequest({
        provider: 'openai',
        model: 'gpt-4o',
        workspaceId: 'ws-1',
        environmentVariables: { RUNTIME_TOKEN: 'runtime-secret' },
      })
    )

    expect(res.status).toBe(200)
    expect(mockPrepareCopilotEnvironmentContext).toHaveBeenCalledWith('user-1', 'ws-1')
    expect(mockExecuteProviderRequest).toHaveBeenCalledWith(
      'openai',
      expect.objectContaining({
        environmentVariables: { RUNTIME_TOKEN: 'runtime-secret' },
      }),
      expect.objectContaining({ resolvedSecretTraceRegistry: expect.anything() })
    )
  })

  it('imports authenticated active provenance', async () => {
    const provenance = {
      version: 1,
      complete: true,
      entries: [{ encryptedValue: 'encrypted-secret', name: 'TOKEN' }],
      scope: { userId: 'user-1', workspaceId: 'ws-1' },
    }
    const res = await POST(
      createMockRequest(
        'POST',
        {
          provider: 'openai',
          model: 'gpt-4o',
          workspaceId: 'ws-1',
          __resolvedSecretTraceProvenance: provenance,
        },
        { 'x-sim-private-model-input-provenance': 'resolved-secret-provenance-v1' }
      )
    )

    expect(res.status).toBe(200)
    expect(mockImportProvenance).toHaveBeenCalledWith(provenance, {
      trusted: true,
      origin: 'providersRoute.requestProvenance',
    })
  })

  it('projects legacy private prompt provenance on the provider-facing copy', async () => {
    mockProjectResolvedSecretModelContent.mockReturnValue({
      safe: true,
      value: {
        systemPrompt: 'Use {{TOKEN}} safely',
        context: '[{"role":"user","content":"{{TOKEN}}"}]',
      },
    })

    const res = await POST(
      createMockRequest(
        'POST',
        {
          provider: 'openai',
          model: 'gpt-4o',
          workspaceId: 'ws-1',
          systemPrompt: 'Use secret-value safely',
          context: '[{"role":"user","content":"secret-value"}]',
          __resolvedSecretTraceProvenance: { version: 1, complete: true, entries: [] },
        },
        { 'x-sim-private-model-input-provenance': 'resolved-secret-provenance-v1' }
      )
    )

    expect(res.status).toBe(200)
    expect(mockExecuteProviderRequest).toHaveBeenCalledWith(
      'openai',
      expect.objectContaining({
        systemPrompt: 'Use {{TOKEN}} safely',
        context: '[{"role":"user","content":"{{TOKEN}}"}]',
      }),
      expect.anything()
    )
  })

  it('does not re-project an explicitly projected private request', async () => {
    mockProjectResolvedSecretModelContent.mockReturnValue({
      safe: true,
      value: { systemPrompt: 'Bo{{TOKEN}}', context: undefined },
    })

    const res = await POST(
      createProviderRequest({
        provider: 'openai',
        model: 'gpt-4o',
        workspaceId: 'ws-1',
        systemPrompt: 'Box',
      })
    )

    expect(res.status).toBe(200)
    expect(mockProjectResolvedSecretModelContent).not.toHaveBeenCalled()
    expect(mockExecuteProviderRequest).toHaveBeenCalledWith(
      'openai',
      expect.objectContaining({ systemPrompt: 'Box' }),
      expect.anything()
    )
  })

  it('rejects a projected marker without a private provenance envelope', async () => {
    const res = await POST(
      createMockRequest(
        'POST',
        { provider: 'openai', model: 'gpt-4o', workspaceId: 'ws-1' },
        { [PRIVATE_MODEL_INPUT_STATE_HEADER]: PROJECTED_MODEL_INPUT_PATHS_V1 }
      )
    )

    expect(res.status).toBe(400)
    expect(mockExecuteProviderRequest).not.toHaveBeenCalled()
  })

  it('rejects an unknown private projection marker', async () => {
    const res = await POST(
      createProviderRequest(
        { provider: 'openai', model: 'gpt-4o', workspaceId: 'ws-1' },
        { [PRIVATE_MODEL_INPUT_STATE_HEADER]: 'unknown-projection' }
      )
    )

    expect(res.status).toBe(400)
    expect(mockExecuteProviderRequest).not.toHaveBeenCalled()
  })

  it('rejects a partial private provenance envelope', async () => {
    const res = await POST(
      createMockRequest(
        'POST',
        { provider: 'openai', model: 'gpt-4o', workspaceId: 'ws-1' },
        { 'x-sim-private-model-input-provenance': 'resolved-secret-provenance-v1' }
      )
    )

    expect(res.status).toBe(400)
    expect(mockExecuteProviderRequest).not.toHaveBeenCalled()
  })

  it('preserves legacy internal requests without the private provenance envelope', async () => {
    const res = await POST(
      createMockRequest('POST', {
        provider: 'openai',
        model: 'gpt-4o',
        workspaceId: 'ws-1',
      })
    )

    expect(res.status).toBe(200)
    expect(mockImportProvenance).not.toHaveBeenCalled()
    expect(mockExecuteProviderRequest).toHaveBeenCalled()
  })

  it('omits provisional stream output from the execution header', async () => {
    mockExecuteProviderRequest.mockResolvedValue({
      streamFormat: 'agent-events-v1',
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: 'text_delta', text: 'hello', turn: 'final' })
          controller.close()
        },
      }),
      execution: {
        success: true,
        output: {
          content: '',
          model: 'gpt-4o',
          tokens: { input: 0, output: 0, total: 0 },
          cost: { input: 0, output: 0, total: 0 },
          providerTiming: {
            startTime: '2026-07-01T00:00:00.000Z',
            endTime: '2026-07-01T00:00:00.000Z',
            duration: 0,
          },
        },
        logs: [],
        metadata: {
          startTime: '2026-07-01T00:00:00.000Z',
          endTime: '2026-07-01T00:00:00.000Z',
          duration: 0,
        },
        isStreaming: true,
      },
    })

    const res = await POST(
      createProviderRequest({
        provider: 'openai',
        model: 'gpt-4o',
        workspaceId: 'ws-1',
        stream: true,
      })
    )

    expect(res.status).toBe(200)
    expect(await res.text()).toBe('hello')
    const executionHeader = JSON.parse(res.headers.get('X-Execution-Data') ?? '{}')
    expect(executionHeader.output).toEqual({ model: 'gpt-4o' })
    expect(executionHeader.metadata).toEqual({ startTime: '2026-07-01T00:00:00.000Z' })
  })

  it('rejects an attribution header when the body has no workspaceId to validate against', async () => {
    const res = await POST(
      createProviderRequest(
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
      createProviderRequest(
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
