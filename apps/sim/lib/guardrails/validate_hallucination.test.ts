import { encryptionMock, encryptionMockFns } from '@sim/testing/mocks/encryption.mock'
import { providersMock, providersMockFns } from '@sim/testing/mocks/providers.mock'
import { providersUtilsMock } from '@sim/testing/mocks/providers-utils.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BillingAttributionSnapshot } from '@/lib/billing/core/billing-attribution'

const { mockSearchKnowledgeAsExecutor } = vi.hoisted(() => ({
  mockSearchKnowledgeAsExecutor: vi.fn(),
}))

vi.mock('@/lib/internal/knowledge/search', () => ({
  searchKnowledgeAsExecutor: mockSearchKnowledgeAsExecutor,
}))

vi.mock('@/lib/core/security/encryption', () => encryptionMock)

vi.mock('@/providers', () => providersMock)

vi.mock('@/providers/utils', () => providersUtilsMock)

import { validateHallucination } from '@/lib/guardrails/validate_hallucination'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const mockExecuteProviderRequest = providersMockFns.mockExecuteProviderRequest
const mockDecryptSecret = encryptionMockFns.mockDecryptSecret

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

function createInput(registry: ResolvedSecretTraceRegistry) {
  const executionContext = {
    workflowId: 'workflow-1',
    workspaceId: 'workspace-1',
    executionId: 'execution-1',
    userId: 'user-1',
    executorDelegationOrigin: {
      subjectUserId: 'user-1',
      workflowId: 'workflow-1',
      executionId: 'execution-1',
    },
  }
  return {
    userInput: 'secret-value __var_FOREIGN',
    knowledgeBaseId: 'kb-1',
    threshold: 3,
    topK: 10,
    model: 'test-model',
    workflowId: 'workflow-1',
    workspaceId: 'workspace-1',
    actorUserId: 'user-1',
    executionContext,
    billingAttribution: BILLING_ATTRIBUTION,
    requestId: 'request-1',
    resolvedSecretTraceRegistry: registry,
  }
}

describe('validateHallucination', () => {
  beforeEach(() => {
    mockDecryptSecret.mockImplementation(async (encryptedValue: string) => ({
      decrypted:
        encryptedValue === 'encrypted-reference-secret' ? 'reference-secret' : encryptedValue,
    }))
    mockSearchKnowledgeAsExecutor.mockImplementation(
      async ({ resolvedSecretTraceRegistry, modelInputPaths }) => ({
        results: [{ content: 'public context' }],
        registry: resolvedSecretTraceRegistry.forkForInputPaths(modelInputPaths),
      })
    )
    mockExecuteProviderRequest.mockResolvedValue({
      content: JSON.stringify({ score: 8, reasoning: 'supported' }),
      model: 'test-model',
      tokens: { input: 1, output: 1, total: 2 },
    })
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
    mockSearchKnowledgeAsExecutor.mockImplementation(async (input) => {
      const resultRegistry = input.resolvedSecretTraceRegistry.forkForInputPaths(
        input.modelInputPaths
      )
      await resultRegistry.importProvenance(
        {
          version: 1,
          complete: true,
          entries: [{ name: 'KB_TOKEN', encryptedValue: 'encrypted-reference-secret' }],
        },
        { origin: 'test.knowledgeResult', trusted: true }
      )
      return { results: [{ content: 'Box reference-secret' }], registry: resultRegistry }
    })

    const result = await validateHallucination(createInput(registry))

    expect(result).toMatchObject({ passed: true, score: 8 })
    expect(mockSearchKnowledgeAsExecutor).toHaveBeenCalledWith({
      knowledgeBaseIds: ['kb-1'],
      query: 'secret-value __var_FOREIGN',
      topK: 10,
      workspaceId: 'workspace-1',
      context: expect.objectContaining({
        workflowId: 'workflow-1',
        executorDelegationOrigin: expect.objectContaining({ workflowId: 'workflow-1' }),
      }),
      billingAttribution: BILLING_ATTRIBUTION,
      resolvedSecretTraceRegistry: registry,
      modelInputPaths: [['input']],
      signal: undefined,
    })

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
    expect(providerContext.resolvedSecretTraceRegistry).not.toBe(registry)
    expect(providerContext.resolvedSecretTraceRegistry.getModelEgressSnapshot()).toMatchObject({
      complete: true,
      matches: expect.arrayContaining([
        { plaintext: 'secret-value', replacement: '{{TOKEN}}' },
        { plaintext: 'reference-secret', replacement: '{{KB_TOKEN}}' },
      ]),
    })
  })

  it('fails validation when the authorized Knowledge operation is rejected', async () => {
    const registry = new ResolvedSecretTraceRegistry()
    mockSearchKnowledgeAsExecutor.mockRejectedValue(new Error('Unauthorized'))

    const result = await validateHallucination(createInput(registry))

    expect(result).toEqual({
      passed: false,
      error: 'Validation error: Failed to query knowledge base: Unauthorized',
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
    mockSearchKnowledgeAsExecutor.mockImplementation(
      async ({ resolvedSecretTraceRegistry, modelInputPaths }) => ({
        results: [{ content: 'reference' }],
        registry: resolvedSecretTraceRegistry.forkForInputPaths(modelInputPaths),
      })
    )

    const abort = Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' })
    mockExecuteProviderRequest.mockRejectedValueOnce(abort)

    await expect(validateHallucination(createInput(registry))).rejects.toMatchObject({
      name: 'AbortError',
    })
  })
})
