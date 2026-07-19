/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockRecordUsage,
  mockToBillingContext,
  mockCheckAndBillPayerOverageThreshold,
  mockCalculateCost,
} = vi.hoisted(() => ({
  mockRecordUsage: vi.fn(),
  mockToBillingContext: vi.fn(),
  mockCheckAndBillPayerOverageThreshold: vi.fn(),
  mockCalculateCost: vi.fn(),
}))

vi.mock('@/lib/billing/core/usage-log', () => ({
  recordUsage: mockRecordUsage,
}))

vi.mock('@/lib/billing/core/billing-attribution', () => ({
  resolveBillingAttribution: vi.fn(),
  toBillingContext: mockToBillingContext,
}))

vi.mock('@/lib/billing/threshold-billing', () => ({
  checkAndBillPayerOverageThreshold: mockCheckAndBillPayerOverageThreshold,
}))

vi.mock('@/lib/api-key/byok', () => ({
  getBYOKKey: vi.fn(),
}))

vi.mock('@/lib/core/config/api-keys', () => ({
  getRotatingApiKey: vi.fn(),
}))

vi.mock('@/lib/core/config/env', () => ({
  env: {},
  getEnv: vi.fn(() => undefined),
  envNumber: (_value: unknown, fallback: number) => fallback,
}))

vi.mock('@/lib/knowledge/documents/utils', () => ({
  isRetryableError: vi.fn(),
  retryWithExponentialBackoff: vi.fn(),
}))

vi.mock('@/lib/knowledge/embedding-models', () => ({
  DEFAULT_EMBEDDING_MODEL: 'text-embedding-3-small',
  EMBEDDING_DIMENSIONS: { 'text-embedding-3-small': 1536 },
  SUPPORTED_EMBEDDING_MODELS: ['text-embedding-3-small'],
  getEmbeddingModelInfo: vi.fn(() => ({ tokenizerProvider: 'openai' })),
}))

vi.mock('@/lib/tokenization', () => ({
  batchByTokenLimit: vi.fn(),
  estimateTokenCount: vi.fn(() => ({ count: 100 })),
}))

vi.mock('@/providers/utils', () => ({
  calculateCost: mockCalculateCost,
}))

import { recordSearchEmbeddingUsage } from '@/lib/knowledge/embeddings'

describe('recordSearchEmbeddingUsage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCalculateCost.mockReturnValue({ total: 0.01 })
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
