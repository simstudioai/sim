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

const { mockDecryptSecret, mockExecuteProviderRequest, mockGenerateInternalToken } = vi.hoisted(
  () => ({
    mockDecryptSecret: vi.fn(),
    mockExecuteProviderRequest: vi.fn(),
    mockGenerateInternalToken: vi.fn(),
  })
)

vi.mock('@/lib/auth/internal', () => ({
  generateInternalToken: mockGenerateInternalToken,
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
import {
  EMPTY_NON_SECRET_NAMES,
  ResolvedSecretTraceRegistry,
} from '@/executor/utils/resolved-secret-trace-registry'

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
    mockGenerateInternalToken.mockResolvedValue('minted-internal-token')
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

  it('uses authenticated private Knowledge transport and carries result provenance into the provider boundary', async () => {
    const registry = new ResolvedSecretTraceRegistry(
      [{ name: 'TOKEN', plaintext: 'secret-value', encryptedValue: 'ciphertext' }],
      undefined,
      EMPTY_NON_SECRET_NAMES
    )
    expect(registry.recordResolved('TOKEN', 'secret-value')).toBe(true)
    const knowledgeBody = {
      data: { results: [{ content: 'reference-secret' }] },
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
    expect(mockGenerateInternalToken).toHaveBeenCalledWith('user-1')

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
    expect(searchBody.query).toBe('{{TOKEN}} __var_FOREIGN')
    expect(searchBody.__resolvedSecretTraceProvenance).toEqual({
      version: 1,
      complete: true,
      entries: [],
    })
    expect(JSON.stringify(searchBody)).not.toContain('secret-value')
    expect(JSON.stringify(searchBody)).toContain('__var_FOREIGN')

    const providerCall = mockExecuteProviderRequest.mock.calls[0]
    const providerRequest = providerCall[1] as { messages: Array<{ content: string }> }
    const providerContext = providerCall[2] as {
      resolvedSecretTraceRegistry: ResolvedSecretTraceRegistry
    }
    expect(providerRequest.messages[0].content).toContain('reference-secret')
    expect(providerRequest.messages[0].content).not.toContain(RESOLVED_SECRET_PROVENANCE_FIELD)
    expect(providerContext.resolvedSecretTraceRegistry).not.toBe(registry)
    expect(providerContext.resolvedSecretTraceRegistry.getModelEgressSnapshot()).toMatchObject({
      complete: true,
      matches: expect.arrayContaining([
        { plaintext: 'reference-secret', replacement: '{{KB_TOKEN}}' },
      ]),
    })
  })

  it('fails only the hallucination model-bound leg when Knowledge omits private provenance', async () => {
    const registry = new ResolvedSecretTraceRegistry([], undefined, EMPTY_NON_SECRET_NAMES)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ data: { results: [{ content: 'public context' }] } }))
    )

    const result = await validateHallucination(createInput(registry))

    expect(result).toEqual({
      passed: false,
      error: 'Validation error: Knowledge result secret provenance is unavailable',
    })
    expect(mockExecuteProviderRequest).not.toHaveBeenCalled()
    expect(registry.isComplete()).toBe(true)
  })

  /**
   * Forwarding the caller's signal means the scoring model can now be aborted. A
   * cancelled run must not be reported as a guardrail verdict — `passed: false` would
   * block content on a run the caller abandoned, which is indistinguishable to a
   * consumer from the model actually hallucinating.
   */
  it('surfaces a cancelled run as cancellation, not as a failed guardrail', async () => {
    const registry = new ResolvedSecretTraceRegistry([], undefined, EMPTY_NON_SECRET_NAMES)
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
