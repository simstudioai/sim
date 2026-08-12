/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BILLING_ATTRIBUTION_HEADER,
  type BillingAttributionSnapshot,
  serializeBillingAttributionHeader,
} from '@/lib/billing/core/billing-attribution'
import {
  PRIVATE_TOOL_METADATA_REQUEST_HEADER,
  PRIVATE_TOOL_METADATA_RESPONSE_HEADER,
  RESOLVED_SECRET_PROVENANCE_FIELD,
  RESOLVED_SECRET_PROVENANCE_METADATA_V1,
} from '@/lib/execution/private-tool-metadata'

const { mockDecryptSecret, mockExecuteProviderRequest, mockGenerateInternalDelegationToken } =
  vi.hoisted(() => ({
    mockDecryptSecret: vi.fn(),
    mockExecuteProviderRequest: vi.fn(),
    mockGenerateInternalDelegationToken: vi.fn(),
  }))

vi.mock('@/lib/auth/internal', () => ({
  generateInternalDelegationToken: mockGenerateInternalDelegationToken,
}))

vi.mock('@/lib/core/security/encryption', () => ({
  decryptSecret: mockDecryptSecret,
}))

vi.mock('@/providers', () => ({
  executeProviderRequest: mockExecuteProviderRequest,
}))

vi.mock('@/providers/utils', () => ({
  getProviderFromModel: vi.fn(() => 'openai'),
}))

import { validateHallucination } from '@/lib/guardrails/validate_hallucination'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const BILLING_ATTRIBUTION: BillingAttributionSnapshot = {
  actorUserId: 'user-1',
  workspaceId: 'workspace-1',
  organizationId: null,
  billedAccountUserId: 'user-1',
  billingEntity: { type: 'user', id: 'user-1' },
  billingPeriod: {
    start: '2026-08-01T00:00:00.000Z',
    end: '2026-09-01T00:00:00.000Z',
  },
  payerSubscription: null,
}

function createPrivateKnowledgeResponse(
  functionalBody: Record<string, unknown>,
  provenance: Record<string, unknown> = { version: 1, complete: true, entries: [] }
): Response {
  return Response.json(
    { ...functionalBody, [RESOLVED_SECRET_PROVENANCE_FIELD]: provenance },
    {
      headers: {
        [PRIVATE_TOOL_METADATA_RESPONSE_HEADER]: RESOLVED_SECRET_PROVENANCE_METADATA_V1,
      },
    }
  )
}

function createInput(registry: ResolvedSecretTraceRegistry) {
  return {
    userInput: 'secret-value __var_FOREIGN',
    knowledgeBaseId: 'kb-1',
    threshold: 3,
    topK: 10,
    model: 'test-model',
    workflowId: 'workflow-1',
    workspaceId: 'workspace-1',
    actorUserId: 'user-1',
    billingAttribution: BILLING_ATTRIBUTION,
    requestId: 'request-1',
    resolvedSecretTraceRegistry: registry,
  }
}

describe('validateHallucination', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGenerateInternalDelegationToken.mockResolvedValue('minted-internal-token')
    mockDecryptSecret.mockImplementation(async (encryptedValue: string) => ({
      decrypted:
        encryptedValue === 'encrypted-reference-secret' ? 'reference-secret' : encryptedValue,
    }))
    mockExecuteProviderRequest.mockResolvedValue({
      content: JSON.stringify({ score: 8, reasoning: 'supported' }),
      model: 'test-model',
      tokens: { input: 1, output: 1, total: 2 },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('carries exact query and result provenance across both model boundaries', async () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'TOKEN', plaintext: 'secret-value', encryptedValue: 'ciphertext' },
      { name: 'UNUSED', plaintext: 'x', encryptedValue: 'unused-ciphertext' },
    ])
    expect(
      registry.recordResolvedAtInputPath('TOKEN', 'secret-value', ['input'], {
        propagated: true,
      })
    ).toBe(true)
    registry.recordResolvedInputProjection(
      ['input'],
      'secret-value __var_FOREIGN',
      '{{TOKEN}} __var_FOREIGN'
    )
    const knowledgeBody = {
      data: { results: [{ content: 'Box reference-secret' }] },
    }
    const fetchMock = vi.fn(async () =>
      createPrivateKnowledgeResponse(knowledgeBody, {
        version: 1,
        complete: true,
        entries: [{ name: 'KB_TOKEN', encryptedValue: 'encrypted-reference-secret' }],
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await validateHallucination(createInput(registry))

    expect(result).toMatchObject({ passed: true, score: 8 })
    expect(mockGenerateInternalDelegationToken).toHaveBeenCalledWith({
      subjectUserId: 'user-1',
      workflowId: 'workflow-1',
    })

    const [, searchOptions] = fetchMock.mock.calls[0]
    const searchBody = JSON.parse(String(searchOptions?.body)) as {
      query: string
      __resolvedSecretTraceProvenance: unknown
    }
    const searchHeaders = new Headers(searchOptions?.headers)
    expect(searchHeaders.get('authorization')).toBe('Bearer minted-internal-token')
    expect(searchHeaders.get(BILLING_ATTRIBUTION_HEADER)).toBe(
      serializeBillingAttributionHeader(BILLING_ATTRIBUTION)
    )
    expect(searchHeaders.get(PRIVATE_TOOL_METADATA_REQUEST_HEADER)).toBe(
      RESOLVED_SECRET_PROVENANCE_METADATA_V1
    )
    expect(searchHeaders.get('x-sim-private-model-input-provenance')).toBe(
      RESOLVED_SECRET_PROVENANCE_METADATA_V1
    )
    expect(searchBody.query).toBe('secret-value __var_FOREIGN')
    expect(searchBody.__resolvedSecretTraceProvenance).toEqual({
      version: 1,
      complete: true,
      entries: [{ encryptedValue: 'ciphertext', name: 'TOKEN' }],
    })
    expect(JSON.stringify(searchBody)).toContain('__var_FOREIGN')

    const providerCall = mockExecuteProviderRequest.mock.calls[0]
    const providerRequest = providerCall[1] as { messages: Array<{ content: string }> }
    const providerContext = providerCall[2] as {
      resolvedSecretTraceRegistry: ResolvedSecretTraceRegistry
    }
    expect(providerRequest.messages[0].content).toContain('{{TOKEN}} __var_FOREIGN')
    expect(providerRequest.messages[0].content).toContain('Box {{KB_TOKEN}}')
    expect(providerRequest.messages[0].content).not.toContain('{{UNUSED}}')
    expect(providerRequest.messages[0].content).not.toContain('secret-value')
    expect(providerRequest.messages[0].content).not.toContain('reference-secret')
    expect(providerRequest.messages[0].content).not.toContain(RESOLVED_SECRET_PROVENANCE_FIELD)
    expect(providerContext.resolvedSecretTraceRegistry).not.toBe(registry)
    expect(providerContext.resolvedSecretTraceRegistry.getModelEgressSnapshot()).toMatchObject({
      complete: true,
      matches: expect.arrayContaining([
        { plaintext: 'secret-value', replacement: '{{TOKEN}}' },
        { plaintext: 'reference-secret', replacement: '{{KB_TOKEN}}' },
      ]),
    })
  })

  it('accepts a successful legacy Knowledge response without private provenance', async () => {
    const registry = new ResolvedSecretTraceRegistry()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ data: { results: [{ content: 'public context' }] } }))
    )

    const result = await validateHallucination(createInput(registry))

    expect(result).toMatchObject({ passed: true, score: 8 })
    const providerRequest = mockExecuteProviderRequest.mock.calls[0][1] as {
      messages: Array<{ content: string }>
    }
    expect(providerRequest.messages[0].content).toContain('public context')
    expect(registry.isComplete()).toBe(true)
  })

  it('fails validation when the delegated Knowledge query is rejected', async () => {
    const registry = new ResolvedSecretTraceRegistry()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 401 }))
    )

    const result = await validateHallucination(createInput(registry))

    expect(result).toEqual({
      passed: false,
      error:
        'Validation error: Failed to query knowledge base: Knowledge base query failed with status 401',
    })
    expect(mockExecuteProviderRequest).not.toHaveBeenCalled()
  })

  /**
   * Forwarding the caller's signal means the scoring model can now be aborted. A
   * cancelled run must not be reported as a guardrail verdict — `passed: false` would
   * block content on a run the caller abandoned, which is indistinguishable to a
   * consumer from the model actually hallucinating.
   */
  it('surfaces a cancelled run as cancellation, not as a failed guardrail', async () => {
    const registry = new ResolvedSecretTraceRegistry()
    const fetchMock = vi.fn(async () =>
      createPrivateKnowledgeResponse({ data: { results: [{ content: 'reference' }] } })
    )
    vi.stubGlobal('fetch', fetchMock)

    const abort = Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' })
    mockExecuteProviderRequest.mockRejectedValueOnce(abort)

    await expect(validateHallucination(createInput(registry))).rejects.toMatchObject({
      name: 'AbortError',
    })
  })
})
