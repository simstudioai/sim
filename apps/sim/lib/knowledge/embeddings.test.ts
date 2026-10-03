import { setupGlobalFetchMock } from '@sim/testing/mocks'
import { mockEnvObject, resetEnvMock } from '@sim/testing/mocks/env.mock'
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from 'vitest'
import * as billingAttributionModule from '@/lib/billing/core/billing-attribution'
import * as usageLogModule from '@/lib/billing/core/usage-log'
import * as thresholdBillingModule from '@/lib/billing/threshold-billing'
import * as embeddingModelsModule from '@/lib/knowledge/embedding-models'
import { generateSearchEmbedding, recordSearchEmbeddingUsage } from '@/lib/knowledge/embeddings'
import { runWithKnowledgeModelInputProvenance } from '@/lib/knowledge/model-input-provenance'
import * as tokenizationModule from '@/lib/tokenization'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import * as providersUtilsModule from '@/providers/utils'

vi.mock('@/lib/core/rate-limiter/provider-admission', () => ({
  PROVIDER_QUOTA_COOLDOWN_MS: 300_000,
  ProviderQuotaExhaustedError: class ProviderQuotaExhaustedError extends Error {},
  ProviderAdmissionTimeoutError: class ProviderAdmissionTimeoutError extends Error {},
  isProviderQuotaExhausted: vi.fn().mockResolvedValue(false),
  recordProviderCooldown: vi.fn().mockResolvedValue(undefined),
  waitForProviderAdmission: vi.fn().mockResolvedValue(undefined),
}))

/**
 * Spy on the real module namespaces instead of vi.mock: under `isolate: false`
 * `@/lib/knowledge/embeddings` is a shared consumer cached across test files,
 * so vi.mock here would bind this file's fixtures into it for every later
 * file. Patching the real namespaces (and restoring afterAll) is the only
 * wiring that composes.
 */
let mockRecordUsage: MockInstance<typeof usageLogModule.recordUsage>
let mockToBillingContext: MockInstance<typeof billingAttributionModule.toBillingContext>
let mockCheckAndBillPayerOverageThreshold: MockInstance<
  typeof thresholdBillingModule.checkAndBillPayerOverageThreshold
>
let mockCalculateCost: MockInstance<typeof providersUtilsModule.calculateCost>
let estimateTokenCountSpy: MockInstance<typeof tokenizationModule.estimateTokenCount>
let getEmbeddingModelInfoSpy: MockInstance<typeof embeddingModelsModule.getEmbeddingModelInfo>
beforeEach(() => {
  mockRecordUsage = vi.spyOn(usageLogModule, 'recordUsage').mockResolvedValue(undefined as never)
  mockToBillingContext = vi.spyOn(billingAttributionModule, 'toBillingContext')
  mockCheckAndBillPayerOverageThreshold = vi
    .spyOn(thresholdBillingModule, 'checkAndBillPayerOverageThreshold')
    .mockResolvedValue(undefined as never)
  mockCalculateCost = vi.spyOn(providersUtilsModule, 'calculateCost')
  estimateTokenCountSpy = vi
    .spyOn(tokenizationModule, 'estimateTokenCount')
    .mockReturnValue({ count: 100 } as never)
  getEmbeddingModelInfoSpy = vi
    .spyOn(embeddingModelsModule, 'getEmbeddingModelInfo')
    .mockReturnValue({ tokenizerProvider: 'openai' } as never)
})

afterAll(() => {
  mockRecordUsage.mockRestore()
  mockToBillingContext.mockRestore()
  mockCheckAndBillPayerOverageThreshold.mockRestore()
  mockCalculateCost.mockRestore()
  estimateTokenCountSpy.mockRestore()
  getEmbeddingModelInfoSpy.mockRestore()
})

describe('recordSearchEmbeddingUsage', () => {
  beforeEach(() => {
    mockRecordUsage.mockResolvedValue(undefined as never)
    mockCheckAndBillPayerOverageThreshold.mockResolvedValue(undefined as never)
    estimateTokenCountSpy.mockReturnValue({ count: 100 } as never)
    getEmbeddingModelInfoSpy.mockReturnValue({ tokenizerProvider: 'openai' } as never)
    mockCalculateCost.mockReturnValue({ total: 0.01 } as never)
    mockToBillingContext.mockReturnValue({
      billingEntity: { type: 'organization', id: 'org-1' },
      billingPeriod: {
        start: new Date('2026-07-01T00:00:00.000Z'),
        end: new Date('2026-08-01T00:00:00.000Z'),
      },
    })
  })

  it('records and bills against the attributed workspace payer', async () => {
    await recordSearchEmbeddingUsage({
      userId: 'actor-1',
      workspaceId: 'ws-1',
      embeddingModel: 'text-embedding-3-small',
      query: 'test query',
      isBYOK: false,
      sourceReference: 'search-1',
      billingAttribution: {
        actorUserId: 'actor-1',
        workspaceId: 'ws-1',
        organizationId: 'org-1',
        billedAccountUserId: 'owner-1',
        billingEntity: { type: 'organization', id: 'org-1' },
        billingPeriod: {
          start: '2026-07-01T00:00:00.000Z',
          end: '2026-08-01T00:00:00.000Z',
        },
        payerSubscription: null,
      },
    })

    expect(mockRecordUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'actor-1',
        workspaceId: 'ws-1',
        billingEntity: { type: 'organization', id: 'org-1' },
      })
    )
    expect(mockCheckAndBillPayerOverageThreshold).toHaveBeenCalledWith({
      type: 'organization',
      id: 'org-1',
    })
  })
})

describe('generateSearchEmbedding', () => {
  const target = { model: 'text-embedding-3-small', dimensions: 1536 } as const
  const unconfigured = {
    AZURE_OPENAI_API_KEY: undefined,
    OPENAI_API_KEY: undefined,
    OPENAI_API_KEY_1: undefined,
    OPENAI_API_KEY_2: undefined,
    OPENAI_API_KEY_3: undefined,
    OPENROUTER_API_KEY: undefined,
  }

  beforeEach(() => {
    setupGlobalFetchMock({ json: {} })
    Object.assign(mockEnvObject, unconfigured)
  })

  afterEach(() => {
    resetEnvMock()
  })

  it('projects verified provenance only in the model-bound embedding payload', async () => {
    mockEnvObject.OPENAI_API_KEY = 'test-openai-key'
    const embedding = Buffer.from(new Float32Array(1536).buffer).toString('base64')
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [{ embedding, index: 0 }],
          usage: { prompt_tokens: 1, total_tokens: 1 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    )
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'TOKEN', plaintext: 'secret-value', encryptedValue: 'encrypted-token' },
    ])
    registry.recordResolved('TOKEN', 'secret-value')

    await runWithKnowledgeModelInputProvenance(registry, () =>
      generateSearchEmbedding('prefix secret-value suffix', target)
    )

    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      'https://api.openai.com/v1/embeddings',
      expect.objectContaining({
        body: JSON.stringify({
          input: ['prefix {{TOKEN}} suffix'],
          model: 'text-embedding-3-small',
          encoding_format: 'base64',
          dimensions: 1536,
        }),
      })
    )
  })
})
