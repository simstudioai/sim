/**
 * @vitest-environment node
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as billingAttributionModule from '@/lib/billing/core/billing-attribution'
import * as usageLogModule from '@/lib/billing/core/usage-log'
import * as thresholdBillingModule from '@/lib/billing/threshold-billing'
import * as embeddingModelsModule from '@/lib/knowledge/embedding-models'
import { recordSearchEmbeddingUsage } from '@/lib/knowledge/embeddings'
import * as tokenizationModule from '@/lib/tokenization'
import * as providersUtilsModule from '@/providers/utils'

/**
 * Spy on the real module namespaces instead of vi.mock: under `isolate: false`
 * `@/lib/knowledge/embeddings` is a shared consumer cached across test files,
 * so vi.mock here would bind this file's fixtures into it for every later
 * file. Patching the real namespaces (and restoring afterAll) is the only
 * wiring that composes.
 */
const mockRecordUsage = vi
  .spyOn(usageLogModule, 'recordUsage')
  .mockResolvedValue(undefined as never)
const mockToBillingContext = vi.spyOn(billingAttributionModule, 'toBillingContext')
const mockCheckAndBillPayerOverageThreshold = vi
  .spyOn(thresholdBillingModule, 'checkAndBillPayerOverageThreshold')
  .mockResolvedValue(undefined as never)
const mockCalculateCost = vi.spyOn(providersUtilsModule, 'calculateCost')
const estimateTokenCountSpy = vi
  .spyOn(tokenizationModule, 'estimateTokenCount')
  .mockReturnValue({ count: 100 } as never)
const getEmbeddingModelInfoSpy = vi
  .spyOn(embeddingModelsModule, 'getEmbeddingModelInfo')
  .mockReturnValue({ tokenizerProvider: 'openai' } as never)

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
    vi.clearAllMocks()
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
