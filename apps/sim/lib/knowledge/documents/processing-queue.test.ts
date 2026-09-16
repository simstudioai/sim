/**
 * @vitest-environment node
 */
import {
  dbChainMockFns,
  defaultMockEnv,
  flattenMockConditions,
  hasMockCondition,
  type MockCondition,
  queueTableRows,
  resetDbChainMock,
  resetEnvFlagsMock,
  schemaMock,
  setEnvFlags,
} from '@sim/testing'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BillingAttributionSnapshot } from '@/lib/billing/core/billing-attribution'
import { env } from '@/lib/core/config/env'
import {
  markInsideTriggerRun,
  resetInsideTriggerRunForTests,
} from '@/lib/core/config/trigger-runtime'
import { SyncLockLostException } from '@/lib/knowledge/connectors/sync-lock'
import { DOCUMENT_PROCESSING_STALE_THRESHOLD_MS } from '@/lib/knowledge/documents/processing-timeouts.server'
import { QUEUED_DISPATCH_GRACE_MS } from '@/lib/knowledge/documents/types'

const { mockBatchTrigger, mockResolveTriggerRegion } = vi.hoisted(() => ({
  mockBatchTrigger: vi.fn(),
  mockResolveTriggerRegion: vi.fn().mockResolvedValue('us-east-1'),
}))

vi.mock('@trigger.dev/sdk', () => ({
  tasks: {
    batchTrigger: mockBatchTrigger,
  },
}))
vi.mock('@/lib/core/async-jobs/region', () => ({
  resolveTriggerRegion: mockResolveTriggerRegion,
}))
/**
 * Under `isolate: false` the shared `@/lib/knowledge/embeddings` /
 * `documents/service` modules may be cached bound to the REAL env module, so
 * mutate the real `env` object per test (restored afterAll) instead of
 * vi.mock'ing a file-local replacement a cached consumer would never see.
 */
const envSnapshot = { ...env }

afterAll(() => {
  for (const key of Object.keys(env)) {
    delete (env as Record<string, unknown>)[key]
  }
  Object.assign(env, envSnapshot)
})

import { processDocumentsWithQueue } from '@/lib/knowledge/documents/service'

const BILLING_ATTRIBUTION = {
  actorUserId: 'external-admin',
  workspaceId: 'workspace-1',
  organizationId: null,
  billedAccountUserId: 'workspace-owner',
  billingEntity: { type: 'user', id: 'workspace-owner' },
  billingPeriod: {
    start: '2026-07-01T00:00:00.000Z',
    end: '2026-08-01T00:00:00.000Z',
  },
  payerSubscription: null,
} satisfies BillingAttributionSnapshot

const DOCUMENT = {
  documentId: 'document-1',
  filename: 'document.txt',
  fileUrl: 'https://example.com/document.txt',
  fileSize: 128,
  mimeType: 'text/plain',
}

beforeAll(() => {
  setEnvFlags({ isTriggerDevEnabled: true })
})

afterAll(resetEnvFlagsMock)

describe('processDocumentsWithQueue billing attribution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    // The processing claim is guarded and returns the row it claimed; without a
    // stub every worker would read as 'already completed' and return early.
    dbChainMockFns.returning.mockResolvedValue([{ id: 'document-1' }])
    mockBatchTrigger.mockResolvedValue({ batchId: 'batch-1' })
    mockResolveTriggerRegion.mockResolvedValue('us-east-1')
    for (const key of Object.keys(env)) {
      delete (env as Record<string, unknown>)[key]
    }
    Object.assign(env, { ...defaultMockEnv, TRIGGER_SECRET_KEY: 'trigger-secret' })
  })

  it('validates and preserves workspace attribution before enqueue', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      { userId: 'knowledge-owner', workspaceId: 'workspace-1' },
    ])

    await processDocumentsWithQueue(
      [DOCUMENT],
      'knowledge-base-1',
      {},
      'request-1',
      BILLING_ATTRIBUTION
    )

    const jobs = mockBatchTrigger.mock.calls[0][1]
    const queueWrite = dbChainMockFns.set.mock.calls.find(
      (call) => (call[0] as Record<string, unknown> | undefined)?.processingQueuedAt instanceof Date
    )
    expect(queueWrite).toBeDefined()
    const processingQueuedAt = (queueWrite?.[0] as Record<string, unknown>)
      .processingQueuedAt as Date
    expect(structuredClone(jobs[0].payload)).toEqual({
      knowledgeBaseId: 'knowledge-base-1',
      documentId: 'document-1',
      docData: {
        filename: 'document.txt',
        fileUrl: 'https://example.com/document.txt',
        fileSize: 128,
        mimeType: 'text/plain',
      },
      processingOptions: {},
      requestId: 'request-1',
      processingQueueToken: 'request-1',
      chargedAtDispatch: true,
      processingQueuedAt: processingQueuedAt.toISOString(),
      billingScope: 'workspace',
      actorUserId: 'external-admin',
      workspaceId: 'workspace-1',
      billingAttribution: BILLING_ATTRIBUTION,
    })

    const freshAdmissionGuard = dbChainMockFns.where.mock.calls.find(
      (call) =>
        hasMockCondition(
          call[0],
          (node: MockCondition) =>
            node.type === 'eq' &&
            node.left === schemaMock.document.processingStatus &&
            node.right === 'pending'
        ) &&
        hasMockCondition(
          call[0],
          (node: MockCondition) =>
            node.type === 'isNull' && node.column === schemaMock.document.processingQueuedAt
        )
    )?.[0]
    expect(freshAdmissionGuard).toBeDefined()
    expect(
      hasMockCondition(
        freshAdmissionGuard,
        (node: MockCondition) =>
          node.type === 'eq' &&
          node.left === schemaMock.document.processingStatus &&
          node.right === 'pending'
      )
    ).toBe(true)
    expect(
      hasMockCondition(
        freshAdmissionGuard,
        (node: MockCondition) =>
          node.type === 'isNull' && node.column === schemaMock.document.processingQueueToken
      )
    ).toBe(false)
    expect(
      hasMockCondition(
        freshAdmissionGuard,
        (node: MockCondition) =>
          node.type === 'isNull' && node.column === schemaMock.document.processingQueuedAt
      )
    ).toBe(true)
  })

  it('rejects missing workspace attribution without enqueueing', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      { userId: 'knowledge-owner', workspaceId: 'workspace-1' },
    ])

    await expect(
      processDocumentsWithQueue([DOCUMENT], 'knowledge-base-1', {}, 'request-1', undefined)
    ).rejects.toThrow('Workspace document processing requires a billing attribution snapshot')
    expect(mockBatchTrigger).not.toHaveBeenCalled()
    const withdrawal = dbChainMockFns.set.mock.calls.find(
      (call) => (call[0] as Record<string, unknown> | undefined)?.processingQueuedAt === null
    )?.[0] as Record<string, unknown> | undefined
    expect(withdrawal).toBeDefined()
    expect(withdrawal).not.toHaveProperty('processingQueueToken')
  })

  it('rejects mismatched workspace attribution without enqueueing', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      { userId: 'knowledge-owner', workspaceId: 'workspace-2' },
    ])

    await expect(
      processDocumentsWithQueue(
        [DOCUMENT],
        'knowledge-base-1',
        {},
        'request-1',
        BILLING_ATTRIBUTION
      )
    ).rejects.toThrow('Document processing workspace does not match billing attribution')
    expect(mockBatchTrigger).not.toHaveBeenCalled()
  })

  it('rejects a knowledge base without a workspace or organization owner', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      { userId: 'legacy-owner', workspaceId: null, organizationId: null },
    ])

    await expect(
      processDocumentsWithQueue([DOCUMENT], 'knowledge-base-1', {}, 'request-1', undefined)
    ).rejects.toThrow('Document processing requires a workspace or organization owner')
    expect(mockBatchTrigger).not.toHaveBeenCalled()
  })
})

/**
 * The per-document fan-out was inert in production because `isTriggerAvailable()`
 * inferred availability from environment variables that the app container sets
 * and the Trigger.dev worker does not. A run process is authoritative about its
 * own runtime, so the marker has to beat both environment conjuncts.
 */
describe('processDocumentsWithQueue dispatch backend', () => {
  function guardForResumeWrite(): unknown {
    const setIndex = dbChainMockFns.set.mock.calls.findIndex(
      (call) =>
        (call[0] as Record<string, unknown> | undefined)?.processingQueueToken === 'request-1' &&
        !('processingQueuedAt' in ((call[0] as Record<string, unknown> | undefined) ?? {}))
    )
    expect(setIndex).toBeGreaterThanOrEqual(0)
    const setOrder = dbChainMockFns.set.mock.invocationCallOrder[setIndex]
    const whereIndex = dbChainMockFns.where.mock.invocationCallOrder.findIndex(
      (whereOrder) => whereOrder > setOrder
    )
    expect(whereIndex).toBeGreaterThanOrEqual(0)
    return dbChainMockFns.where.mock.calls[whereIndex]?.[0]
  }

  function resumeAlternatives(guard: unknown): MockCondition[] {
    const alternatives = flattenMockConditions(guard).find(
      (node) =>
        node.type === 'or' &&
        (node.conditions as MockCondition[]).some((condition) =>
          hasMockCondition(
            condition,
            (nested) =>
              nested.type === 'eq' &&
              nested.left === schemaMock.document.processingQueueToken &&
              nested.right === 'request-1'
          )
        ) &&
        (node.conditions as MockCondition[]).some((condition) =>
          hasMockCondition(
            condition,
            (nested) =>
              nested.type === 'isNull' && nested.column === schemaMock.document.processingQueueToken
          )
        )
    )?.conditions
    expect(alternatives).toBeDefined()
    expect(alternatives).toHaveLength(2)
    const conditions = alternatives as MockCondition[]
    expect(
      conditions.filter((condition) =>
        hasMockCondition(
          condition,
          (node) =>
            node.type === 'eq' &&
            node.left === schemaMock.document.processingQueueToken &&
            node.right === 'request-1'
        )
      )
    ).toHaveLength(1)
    expect(
      conditions.filter((condition) =>
        hasMockCondition(
          condition,
          (node) =>
            node.type === 'isNull' && node.column === schemaMock.document.processingQueueToken
        )
      )
    ).toHaveLength(1)
    return conditions
  }

  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    // The processing claim is guarded and returns the row it claimed; without a
    // stub every worker would read as 'already completed' and return early.
    dbChainMockFns.returning.mockResolvedValue([{ id: 'document-1' }])
    resetInsideTriggerRunForTests()
    mockBatchTrigger.mockResolvedValue({ batchId: 'batch-1' })
    mockResolveTriggerRegion.mockResolvedValue('us-east-1')
    for (const key of Object.keys(env)) {
      delete (env as Record<string, unknown>)[key]
    }
    Object.assign(env, { ...defaultMockEnv })
    ;(env as Record<string, unknown>).TRIGGER_SECRET_KEY = undefined
    dbChainMockFns.limit.mockResolvedValue([
      { userId: 'knowledge-owner', workspaceId: 'workspace-1' },
    ])
  })

  afterEach(() => {
    vi.useRealTimers()
    resetInsideTriggerRunForTests()
    setEnvFlags({ isTriggerDevEnabled: true })
  })

  it('dispatches via Trigger.dev inside a run with neither env conjunct satisfied', async () => {
    setEnvFlags({ isTriggerDevEnabled: false })
    markInsideTriggerRun()

    await processDocumentsWithQueue(
      [DOCUMENT],
      'knowledge-base-1',
      {},
      'request-1',
      BILLING_ATTRIBUTION
    )

    expect(mockBatchTrigger).toHaveBeenCalledTimes(1)
  })

  it('returns acceptance separately from eventual child completion', async () => {
    markInsideTriggerRun()

    const result = await processDocumentsWithQueue(
      [DOCUMENT],
      'knowledge-base-1',
      {},
      'request-1',
      BILLING_ATTRIBUTION
    )

    expect(result).toEqual({ requested: 1, accepted: 1, failed: 0, failedDocumentIds: [] })
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        processingQueueToken: 'request-1',
        processingDeferredUntil: null,
      })
    )
  })

  it('does not dispatch when a different request owns the queue generation', async () => {
    markInsideTriggerRun()
    dbChainMockFns.returning.mockResolvedValueOnce([]).mockResolvedValueOnce([])
    queueTableRows(schemaMock.document, [{ id: 'document-1' }])

    const result = await processDocumentsWithQueue(
      [DOCUMENT],
      'knowledge-base-1',
      {},
      'request-1',
      BILLING_ATTRIBUTION
    )

    expect(result).toEqual({ requested: 1, accepted: 1, failed: 0, failedDocumentIds: [] })
    expect(mockBatchTrigger).not.toHaveBeenCalled()
  })

  it('does not report a failed row owned by an old queue token as accepted', async () => {
    vi.useFakeTimers()
    const now = new Date('2026-08-25T06:00:00.000Z')
    vi.setSystemTime(now)
    markInsideTriggerRun()
    dbChainMockFns.returning.mockResolvedValueOnce([]).mockResolvedValueOnce([])
    queueTableRows(schemaMock.document, [])

    const result = await processDocumentsWithQueue(
      [DOCUMENT],
      'knowledge-base-1',
      {},
      'request-1',
      BILLING_ATTRIBUTION
    )

    expect(result).toEqual({
      requested: 1,
      accepted: 0,
      failed: 1,
      failedDocumentIds: ['document-1'],
    })
    expect(mockBatchTrigger).not.toHaveBeenCalled()

    const acceptedWithoutDispatchGuard = dbChainMockFns.where.mock.calls.find((call) =>
      flattenMockConditions(call[0]).some(
        (node: MockCondition) =>
          node.type === 'or' &&
          (node.conditions as MockCondition[]).some(
            (condition) =>
              condition.type === 'eq' &&
              condition.left === schemaMock.document.processingStatus &&
              condition.right === 'completed'
          )
      )
    )?.[0]
    expect(acceptedWithoutDispatchGuard).toBeDefined()
    const acceptedStatusGuard = flattenMockConditions(acceptedWithoutDispatchGuard).find(
      (node: MockCondition) => node.type === 'or'
    )
    expect(acceptedStatusGuard).toBeDefined()
    const acceptedStatuses = acceptedStatusGuard?.conditions as MockCondition[]
    expect(acceptedStatuses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'eq',
          left: schemaMock.document.processingStatus,
          right: 'completed',
        }),
      ])
    )
    expect(acceptedStatuses).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'eq',
          left: schemaMock.document.processingStatus,
          right: 'failed',
        }),
      ])
    )
    const pendingWithQueueState = acceptedStatuses.find(
      (condition) =>
        condition.type === 'and' &&
        hasMockCondition(
          condition,
          (node: MockCondition) =>
            node.type === 'eq' &&
            node.left === schemaMock.document.processingStatus &&
            node.right === 'pending'
        ) &&
        hasMockCondition(
          condition,
          (node: MockCondition) =>
            node.type === 'isNotNull' && node.column === schemaMock.document.processingQueuedAt
        )
    )
    expect(pendingWithQueueState).toBeDefined()
    expect(
      hasMockCondition(
        pendingWithQueueState,
        (node: MockCondition) =>
          node.type === 'gte' && node.left === schemaMock.document.processingQueuedAt
      )
    ).toBe(true)
    const queuedFreshness = flattenMockConditions(pendingWithQueueState).find(
      (node: MockCondition) =>
        node.type === 'gte' && node.left === schemaMock.document.processingQueuedAt
    )
    expect(queuedFreshness?.right).toEqual(new Date(now.getTime() - QUEUED_DISPATCH_GRACE_MS))
    const liveProcessingState = acceptedStatuses.find(
      (condition) =>
        condition.type === 'and' &&
        hasMockCondition(
          condition,
          (node: MockCondition) =>
            node.type === 'eq' &&
            node.left === schemaMock.document.processingStatus &&
            node.right === 'processing'
        )
    )
    expect(liveProcessingState).toBeDefined()
    expect(
      hasMockCondition(
        liveProcessingState,
        (node: MockCondition) =>
          node.type === 'isNotNull' && node.column === schemaMock.document.processingStartedAt
      )
    ).toBe(true)
    const processingFreshness = flattenMockConditions(liveProcessingState).find(
      (node: MockCondition) =>
        node.type === 'gte' && node.left === schemaMock.document.processingStartedAt
    )
    expect(processingFreshness?.right).toEqual(
      new Date(now.getTime() - DOCUMENT_PROCESSING_STALE_THRESHOLD_MS)
    )
    expect(
      hasMockCondition(
        liveProcessingState,
        (node: MockCondition) =>
          node.type === 'gte' && node.left === schemaMock.document.processingStartedAt
      )
    ).toBe(true)
  })

  it('resumes the same outbox request with its original stamp and no new charge', async () => {
    markInsideTriggerRun()
    const originalQueuedAt = new Date('2026-08-24T22:00:00.000Z')
    dbChainMockFns.returning
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'document-1', processingQueuedAt: originalQueuedAt }])

    const result = await processDocumentsWithQueue(
      [DOCUMENT],
      'knowledge-base-1',
      {},
      'request-1',
      BILLING_ATTRIBUTION
    )

    expect(result).toEqual({ requested: 1, accepted: 1, failed: 0, failedDocumentIds: [] })
    const payload = mockBatchTrigger.mock.calls[0][1][0].payload
    expect(payload).toMatchObject({
      processingQueueToken: 'request-1',
      processingQueuedAt: originalQueuedAt.toISOString(),
      chargedAtDispatch: false,
    })
    const resumeWrite = dbChainMockFns.set.mock.calls.find(
      (call) =>
        (call[0] as Record<string, unknown> | undefined)?.processingQueueToken === 'request-1' &&
        !('processingQueuedAt' in ((call[0] as Record<string, unknown> | undefined) ?? {}))
    )
    expect(resumeWrite?.[0]).not.toHaveProperty('processingAttempts')

    const resumeGuard = guardForResumeWrite()
    expect(
      hasMockCondition(
        resumeGuard,
        (node: MockCondition) =>
          node.type === 'isNull' && node.column === schemaMock.document.processingDeferredUntil
      )
    ).toBe(true)
    const sameTokenBranch = resumeAlternatives(resumeGuard).find((condition) =>
      hasMockCondition(
        condition,
        (node: MockCondition) =>
          node.type === 'eq' &&
          node.left === schemaMock.document.processingQueueToken &&
          node.right === 'request-1'
      )
    )
    expect(sameTokenBranch).toBeDefined()
    expect(
      hasMockCondition(
        resumeGuard,
        (node: MockCondition) =>
          node.type === 'isNotNull' && node.column === schemaMock.document.processingQueuedAt
      )
    ).toBe(true)
    const statusGuard = flattenMockConditions(sameTokenBranch).find(
      (node: MockCondition) => node.type === 'or'
    )
    expect(statusGuard).toBeDefined()
    const statusConditions = statusGuard?.conditions as MockCondition[]
    expect(statusConditions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'eq',
          left: schemaMock.document.processingStatus,
          right: 'pending',
        }),
        expect.objectContaining({
          type: 'eq',
          left: schemaMock.document.processingStatus,
          right: 'failed',
        }),
      ])
    )
  })

  it('treats a recent legacy queued-at-only row as live without redispatching it', async () => {
    vi.useFakeTimers()
    const now = new Date('2026-08-24T22:00:00.000Z')
    vi.setSystemTime(now)
    markInsideTriggerRun()
    dbChainMockFns.returning.mockResolvedValueOnce([]).mockResolvedValueOnce([])
    queueTableRows(schemaMock.document, [{ id: 'document-1' }])

    const result = await processDocumentsWithQueue(
      [DOCUMENT],
      'knowledge-base-1',
      {},
      'request-1',
      BILLING_ATTRIBUTION
    )

    expect(result).toEqual({ requested: 1, accepted: 1, failed: 0, failedDocumentIds: [] })
    expect(mockBatchTrigger).not.toHaveBeenCalled()
    const resumeWrite = dbChainMockFns.set.mock.calls.find(
      (call) =>
        (call[0] as Record<string, unknown> | undefined)?.processingQueueToken === 'request-1' &&
        !('processingQueuedAt' in ((call[0] as Record<string, unknown> | undefined) ?? {}))
    )
    expect(resumeWrite).toBeDefined()
    const resumeGuard = guardForResumeWrite()
    const legacyBranch = resumeAlternatives(resumeGuard).find(
      (condition) =>
        hasMockCondition(
          condition,
          (node: MockCondition) =>
            node.type === 'isNull' && node.column === schemaMock.document.processingQueueToken
        ) &&
        hasMockCondition(
          condition,
          (node: MockCondition) =>
            node.type === 'lt' && node.left === schemaMock.document.processingQueuedAt
        )
    )
    expect(legacyBranch).toBeDefined()
    const cutoff = flattenMockConditions(legacyBranch).find(
      (node: MockCondition) =>
        node.type === 'lt' && node.left === schemaMock.document.processingQueuedAt
    )
    expect(cutoff?.right).toEqual(new Date(now.getTime() - QUEUED_DISPATCH_GRACE_MS))
  })

  it('CAS-adopts a stale legacy queued-at-only row without charging again', async () => {
    markInsideTriggerRun()
    const legacyQueuedAt = new Date('2020-01-01T00:00:00.000Z')
    dbChainMockFns.returning
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'document-1', processingQueuedAt: legacyQueuedAt }])

    const result = await processDocumentsWithQueue(
      [DOCUMENT],
      'knowledge-base-1',
      {},
      'request-1',
      BILLING_ATTRIBUTION
    )

    expect(result).toEqual({ requested: 1, accepted: 1, failed: 0, failedDocumentIds: [] })
    expect(mockBatchTrigger.mock.calls[0][1][0].payload).toMatchObject({
      processingQueueToken: 'request-1',
      processingQueuedAt: legacyQueuedAt.toISOString(),
      chargedAtDispatch: false,
    })

    const legacyAdoptionGuard = guardForResumeWrite()
    const legacyBranch = resumeAlternatives(legacyAdoptionGuard).find(
      (condition) =>
        hasMockCondition(
          condition,
          (node: MockCondition) =>
            node.type === 'isNull' && node.column === schemaMock.document.processingQueueToken
        ) &&
        hasMockCondition(
          condition,
          (node: MockCondition) =>
            node.type === 'lt' && node.left === schemaMock.document.processingQueuedAt
        )
    )
    expect(legacyBranch).toBeDefined()
    expect(
      hasMockCondition(
        legacyAdoptionGuard,
        (node: MockCondition) =>
          node.type === 'eq' &&
          node.left === schemaMock.document.knowledgeBaseId &&
          node.right === 'knowledge-base-1'
      )
    ).toBe(true)
    for (const column of [schemaMock.document.archivedAt, schemaMock.document.deletedAt]) {
      expect(
        hasMockCondition(
          legacyAdoptionGuard,
          (node: MockCondition) => node.type === 'isNull' && node.column === column
        )
      ).toBe(true)
    }
    const adoptionWrite = dbChainMockFns.set.mock.calls.find(
      (call) =>
        (call[0] as Record<string, unknown> | undefined)?.processingQueueToken === 'request-1' &&
        !('processingQueuedAt' in ((call[0] as Record<string, unknown> | undefined) ?? {}))
    )
    expect(adoptionWrite?.[0]).not.toHaveProperty('processingAttempts')
  })

  it('keeps a pre-claim same-request fallback failure retryable without clearing its stamp', async () => {
    markInsideTriggerRun()
    const originalQueuedAt = new Date('2026-08-24T22:00:00.000Z')
    dbChainMockFns.returning
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'document-1', processingQueuedAt: originalQueuedAt }])
    dbChainMockFns.limit
      .mockResolvedValueOnce([{ userId: 'knowledge-owner', workspaceId: 'workspace-1' }])
      .mockRejectedValueOnce(new Error('direct fallback unavailable'))
    mockBatchTrigger.mockRejectedValueOnce(new Error('trigger unavailable'))

    await expect(
      processDocumentsWithQueue(
        [DOCUMENT],
        'knowledge-base-1',
        {},
        'request-1',
        BILLING_ATTRIBUTION
      )
    ).rejects.toThrow('document processing dispatches failed')

    expect(
      dbChainMockFns.set.mock.calls.some(
        (call) => (call[0] as Record<string, unknown> | undefined)?.processingQueueToken === null
      )
    ).toBe(false)
  })

  it('reports a pre-claim direct fallback failure after a partial Trigger enqueue', async () => {
    markInsideTriggerRun()
    const originalQueuedAt = new Date('2026-08-24T22:00:00.000Z')
    const documents = Array.from({ length: 1001 }, (_, index) => ({
      ...DOCUMENT,
      documentId: `document-${index}`,
      filename: `document-${index}.txt`,
    }))
    dbChainMockFns.returning
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(
        documents.map((doc) => ({ id: doc.documentId, processingQueuedAt: originalQueuedAt }))
      )
    dbChainMockFns.limit
      .mockResolvedValueOnce([{ userId: 'knowledge-owner', workspaceId: 'workspace-1' }])
      .mockRejectedValueOnce(new Error('direct fallback unavailable'))
    mockBatchTrigger
      .mockResolvedValueOnce({ batchId: 'batch-1' })
      .mockRejectedValueOnce(new Error('second batch unavailable'))

    const result = await processDocumentsWithQueue(
      documents,
      'knowledge-base-1',
      {},
      'request-1',
      BILLING_ATTRIBUTION
    )

    expect(result).toEqual({
      requested: 1001,
      accepted: 1000,
      failed: 1,
      failedDocumentIds: ['document-1000'],
    })
  })

  it('deduplicates document IDs while preserving first-seen dispatch order', async () => {
    markInsideTriggerRun()
    const secondDocument = { ...DOCUMENT, documentId: 'document-2', filename: 'second.txt' }
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'document-1' }, { id: 'document-2' }])

    const result = await processDocumentsWithQueue(
      [DOCUMENT, DOCUMENT, secondDocument],
      'knowledge-base-1',
      {},
      'request-1',
      BILLING_ATTRIBUTION
    )

    expect(result).toEqual({ requested: 2, accepted: 2, failed: 0, failedDocumentIds: [] })
    expect(mockBatchTrigger.mock.calls[0][1].map((job) => job.payload.documentId)).toEqual([
      'document-1',
      'document-2',
    ])
  })

  it('returns an empty dispatch summary without resolving billing context', async () => {
    await expect(
      processDocumentsWithQueue([], 'missing-knowledge-base', {}, 'request-1', undefined)
    ).resolves.toEqual({ requested: 0, accepted: 0, failed: 0, failedDocumentIds: [] })

    expect(mockBatchTrigger).not.toHaveBeenCalled()
    expect(dbChainMockFns.limit).not.toHaveBeenCalled()
  })

  it('dispatches via Trigger.dev inside a run when only the secret key is missing', async () => {
    setEnvFlags({ isTriggerDevEnabled: true })
    markInsideTriggerRun()

    await processDocumentsWithQueue(
      [DOCUMENT],
      'knowledge-base-1',
      {},
      'request-1',
      BILLING_ATTRIBUTION
    )

    expect(mockBatchTrigger).toHaveBeenCalledTimes(1)
  })

  it('uses the direct fallback outside a run when the secret key is missing', async () => {
    setEnvFlags({ isTriggerDevEnabled: true })

    await expect(
      processDocumentsWithQueue(
        [DOCUMENT],
        'knowledge-base-1',
        {},
        'request-1',
        BILLING_ATTRIBUTION
      )
    ).resolves.toEqual({ requested: 1, accepted: 1, failed: 0, failedDocumentIds: [] })

    expect(mockBatchTrigger).not.toHaveBeenCalled()
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ processingStatus: 'processing' })
    )
    expect(
      dbChainMockFns.set.mock.calls.some(
        (call) =>
          (call[0] as Record<string, unknown> | undefined)?.processingQueuedAt === null &&
          'processingAttempts' in ((call[0] as Record<string, unknown> | undefined) ?? {})
      )
    ).toBe(false)
  })

  it('withdraws a direct dispatch whose guarded processing claim lost the race', async () => {
    setEnvFlags({ isTriggerDevEnabled: true })
    dbChainMockFns.returning.mockReset()
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'document-1' }]).mockResolvedValueOnce([])
    dbChainMockFns.limit.mockReset()
    dbChainMockFns.limit
      .mockResolvedValueOnce([{ userId: 'knowledge-owner', workspaceId: 'workspace-1' }])
      .mockResolvedValueOnce([
        {
          knowledgeBaseUserId: 'knowledge-owner',
          workspaceId: 'workspace-1',
          filename: DOCUMENT.filename,
          fileUrl: DOCUMENT.fileUrl,
          fileSize: DOCUMENT.fileSize,
          mimeType: DOCUMENT.mimeType,
        },
      ])
      .mockResolvedValueOnce([])

    await expect(
      processDocumentsWithQueue(
        [DOCUMENT],
        'knowledge-base-1',
        {},
        'request-1',
        BILLING_ATTRIBUTION
      )
    ).rejects.toThrow('document processing dispatches failed')

    expect(mockBatchTrigger).not.toHaveBeenCalled()
    expect(
      dbChainMockFns.set.mock.calls.some(
        (call) =>
          (call[0] as Record<string, unknown> | undefined)?.processingQueuedAt === null &&
          'processingAttempts' in ((call[0] as Record<string, unknown> | undefined) ?? {})
      )
    ).toBe(true)
  })

  it('accepts an unclaimed direct dispatch only after revalidating live document state', async () => {
    vi.useFakeTimers()
    const now = new Date('2026-08-25T06:00:00.000Z')
    vi.setSystemTime(now)
    setEnvFlags({ isTriggerDevEnabled: true })
    dbChainMockFns.returning.mockReset()
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'document-1' }]).mockResolvedValueOnce([])
    dbChainMockFns.limit.mockReset()
    dbChainMockFns.limit
      .mockResolvedValueOnce([{ userId: 'knowledge-owner', workspaceId: 'workspace-1' }])
      .mockResolvedValueOnce([
        {
          knowledgeBaseUserId: 'knowledge-owner',
          workspaceId: 'workspace-1',
          filename: DOCUMENT.filename,
          fileUrl: DOCUMENT.fileUrl,
          fileSize: DOCUMENT.fileSize,
          mimeType: DOCUMENT.mimeType,
        },
      ])
      .mockResolvedValueOnce([{ id: 'document-1' }])

    await expect(
      processDocumentsWithQueue(
        [DOCUMENT],
        'knowledge-base-1',
        {},
        'request-1',
        BILLING_ATTRIBUTION
      )
    ).resolves.toEqual({ requested: 1, accepted: 1, failed: 0, failedDocumentIds: [] })

    const revalidationGuard = dbChainMockFns.where.mock.calls.find(
      (call) =>
        hasMockCondition(
          call[0],
          (node: MockCondition) =>
            node.type === 'eq' &&
            node.left === schemaMock.document.id &&
            node.right === 'document-1'
        ) &&
        flattenMockConditions(call[0]).some(
          (node: MockCondition) =>
            node.type === 'or' &&
            (node.conditions as MockCondition[]).some(
              (condition) =>
                condition.type === 'eq' &&
                condition.left === schemaMock.document.processingStatus &&
                condition.right === 'completed'
            )
        )
    )?.[0]
    expect(revalidationGuard).toBeDefined()
    const acceptedStatusGuard = flattenMockConditions(revalidationGuard).find(
      (node: MockCondition) => node.type === 'or'
    )
    const acceptedStatuses = acceptedStatusGuard?.conditions as MockCondition[]
    const pendingState = acceptedStatuses.find(
      (condition) =>
        condition.type === 'and' &&
        hasMockCondition(
          condition,
          (node: MockCondition) =>
            node.type === 'eq' &&
            node.left === schemaMock.document.processingStatus &&
            node.right === 'pending'
        )
    )
    const queuedFreshness = flattenMockConditions(pendingState).find(
      (node: MockCondition) =>
        node.type === 'gte' && node.left === schemaMock.document.processingQueuedAt
    )
    expect(queuedFreshness?.right).toEqual(new Date(now.getTime() - QUEUED_DISPATCH_GRACE_MS))
    const processingState = acceptedStatuses.find(
      (condition) =>
        condition.type === 'and' &&
        hasMockCondition(
          condition,
          (node: MockCondition) =>
            node.type === 'eq' &&
            node.left === schemaMock.document.processingStatus &&
            node.right === 'processing'
        )
    )
    const processingFreshness = flattenMockConditions(processingState).find(
      (node: MockCondition) =>
        node.type === 'gte' && node.left === schemaMock.document.processingStartedAt
    )
    expect(processingFreshness?.right).toEqual(
      new Date(now.getTime() - DOCUMENT_PROCESSING_STALE_THRESHOLD_MS)
    )
    expect(
      dbChainMockFns.set.mock.calls.some(
        (call) =>
          (call[0] as Record<string, unknown> | undefined)?.processingQueuedAt === null &&
          'processingAttempts' in ((call[0] as Record<string, unknown> | undefined) ?? {})
      )
    ).toBe(false)
  })

  it('uses the direct fallback outside a run when the deployment flag is off', async () => {
    setEnvFlags({ isTriggerDevEnabled: false })
    Object.assign(env, { TRIGGER_SECRET_KEY: 'trigger-secret' })

    await expect(
      processDocumentsWithQueue(
        [DOCUMENT],
        'knowledge-base-1',
        {},
        'request-1',
        BILLING_ATTRIBUTION
      )
    ).resolves.toEqual({ requested: 1, accepted: 1, failed: 0, failedDocumentIds: [] })

    expect(mockBatchTrigger).not.toHaveBeenCalled()
  })
})

/**
 * The processing-attempt budget exists to stop re-billing a document that keeps
 * failing the same way *in processing*. A dispatch that never reached a worker
 * teaches it nothing, so the charge is given back on the one path that proves
 * nothing was dispatched. Without the refund a Trigger.dev outage burns the
 * allowance without a single run, and after `MAX_PROCESSING_ATTEMPTS` of them
 * the connector sweep — which skips documents at the cap — permanently stops
 * recovering them.
 */
describe('processDocumentsWithQueue attempt refund', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    dbChainMockFns.returning.mockResolvedValue([{ id: 'document-1' }])
    mockResolveTriggerRegion.mockResolvedValue('us-east-1')
    for (const key of Object.keys(env)) {
      delete (env as Record<string, unknown>)[key]
    }
    Object.assign(env, { ...defaultMockEnv, TRIGGER_SECRET_KEY: 'trigger-secret' })
    dbChainMockFns.limit.mockResolvedValue([
      { userId: 'knowledge-owner', workspaceId: 'workspace-1' },
    ])
  })

  it('refunds the attempt in the same write that withdraws the queue stamp', async () => {
    mockResolveTriggerRegion.mockRejectedValueOnce(new Error('trigger.dev region unavailable'))

    await expect(
      processDocumentsWithQueue(
        [DOCUMENT],
        'knowledge-base-1',
        {},
        'request-1',
        BILLING_ATTRIBUTION
      )
    ).rejects.toThrow('trigger.dev region unavailable')

    const withdrawCall = dbChainMockFns.set.mock.calls.find(
      (call) => (call[0] as Record<string, unknown> | undefined)?.processingQueuedAt === null
    )
    expect(withdrawCall).toBeDefined()

    const values = withdrawCall?.[0] as Record<string, unknown>
    expect(values).not.toHaveProperty('processingQueueToken')
    const attempts = values.processingAttempts as { toSQL: () => { sql: string } } | undefined
    expect(attempts).toBeDefined()
    // Given back as a SQL decrement in the same guarded statement as the stamp,
    // so it can only ever undo the charge this call made.
    expect(attempts?.toSQL().sql).toContain('- 1')
    // Floored, so a refund can never drive the count below zero.
    expect(attempts?.toSQL().sql).toContain('GREATEST')

    const withdrawIndex = dbChainMockFns.set.mock.calls.findIndex(
      (call) => call[0] === withdrawCall?.[0]
    )
    const withdrawOrder = dbChainMockFns.set.mock.invocationCallOrder[withdrawIndex]
    const whereIndex = dbChainMockFns.where.mock.invocationCallOrder.findIndex(
      (order) => order > withdrawOrder
    )
    const withdrawalGuard = dbChainMockFns.where.mock.calls[whereIndex]?.[0]
    const queueWrite = dbChainMockFns.set.mock.calls.find(
      (call) => (call[0] as Record<string, unknown> | undefined)?.processingQueuedAt instanceof Date
    )?.[0] as Record<string, unknown> | undefined
    expect(
      hasMockCondition(
        withdrawalGuard,
        (node: MockCondition) =>
          node.type === 'eq' &&
          node.left === schemaMock.document.processingQueuedAt &&
          node.right === queueWrite?.processingQueuedAt
      )
    ).toBe(true)
  })

  it('leaves the attempt spent when a dispatch did get through', async () => {
    mockBatchTrigger.mockResolvedValue({ batchId: 'batch-1' })

    await processDocumentsWithQueue(
      [DOCUMENT],
      'knowledge-base-1',
      {},
      'request-1',
      BILLING_ATTRIBUTION
    )

    expect(
      dbChainMockFns.set.mock.calls.some(
        (call) => (call[0] as Record<string, unknown> | undefined)?.processingQueuedAt === null
      )
    ).toBe(false)
  })
})

describe('processDocumentsWithQueue under a connector sync lease', () => {
  const lease = {
    connectorId: 'connector-1',
    stillHeld: () => ({ type: 'lease' }) as never,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockBatchTrigger.mockResolvedValue({ batchId: 'batch-1' })
    mockResolveTriggerRegion.mockResolvedValue('us-east-1')
    for (const key of Object.keys(env)) {
      delete (env as Record<string, unknown>)[key]
    }
    Object.assign(env, { ...defaultMockEnv, TRIGGER_SECRET_KEY: 'trigger-secret' })
  })

  /**
   * The document writes proved the lease in their own transactions; the queue
   * write is a later one. A run reclaimed in between must not install a
   * processing generation, spend an attempt, or dispatch beside the
   * replacement run's own dispatch for the same document.
   */
  it('neither marks nor dispatches processing once the lease was reclaimed', async () => {
    dbChainMockFns.for.mockResolvedValueOnce([])

    await expect(
      processDocumentsWithQueue(
        [DOCUMENT],
        'knowledge-base-1',
        {},
        'request-1',
        BILLING_ATTRIBUTION,
        lease
      )
    ).rejects.toBeInstanceOf(SyncLockLostException)

    expect(dbChainMockFns.where).toHaveBeenCalledWith(lease.stillHeld())
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(mockBatchTrigger).not.toHaveBeenCalled()
  })

  it('queues and dispatches while the lease is still held', async () => {
    dbChainMockFns.for.mockResolvedValueOnce([{ id: 'connector-1' }])
    dbChainMockFns.returning.mockResolvedValue([{ id: 'document-1' }])
    dbChainMockFns.limit.mockResolvedValueOnce([
      { userId: 'knowledge-owner', workspaceId: 'workspace-1' },
    ])

    await expect(
      processDocumentsWithQueue(
        [DOCUMENT],
        'knowledge-base-1',
        {},
        'request-1',
        BILLING_ATTRIBUTION,
        lease
      )
    ).resolves.toEqual({ requested: 1, accepted: 1, failed: 0, failedDocumentIds: [] })

    expect(dbChainMockFns.where).toHaveBeenCalledWith(lease.stillHeld())
    expect(mockBatchTrigger).toHaveBeenCalledTimes(1)
  })
})
