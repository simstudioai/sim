/**
 * @vitest-environment node
 */
import {
  dbChainMockFns,
  defaultMockEnv,
  flattenMockConditions,
  hasMockCondition,
  type MockCondition,
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

const { mockBatchTrigger } = vi.hoisted(() => ({
  mockBatchTrigger: vi.fn(),
}))

vi.mock('@trigger.dev/sdk', () => ({
  tasks: {
    batchTrigger: mockBatchTrigger,
  },
}))
vi.mock('@/lib/core/async-jobs/region', () => ({
  resolveTriggerRegion: vi.fn().mockResolvedValue('us-east-1'),
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

    const freshAdmissionGuard = dbChainMockFns.where.mock.calls.find((call) =>
      hasMockCondition(
        call[0],
        (node: MockCondition) =>
          node.type === 'isNull' && node.column === schemaMock.document.processingQueueToken
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

  it('enqueues workspace-less knowledge bases with an explicit non-workspace payload', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ userId: 'legacy-owner', workspaceId: null }])

    await processDocumentsWithQueue([DOCUMENT], 'knowledge-base-1', {}, 'request-1', undefined)

    const jobs = mockBatchTrigger.mock.calls[0][1]
    expect(jobs[0].payload).toMatchObject({
      billingScope: 'non-workspace',
      actorUserId: 'legacy-owner',
      workspaceId: null,
    })
    expect(jobs[0].payload).not.toHaveProperty('billingAttribution')
  })
})

/**
 * The per-document fan-out was inert in production because `isTriggerAvailable()`
 * inferred availability from environment variables that the app container sets
 * and the Trigger.dev worker does not. A run process is authoritative about its
 * own runtime, so the marker has to beat both environment conjuncts.
 */
describe('processDocumentsWithQueue dispatch backend', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    // The processing claim is guarded and returns the row it claimed; without a
    // stub every worker would read as 'already completed' and return early.
    dbChainMockFns.returning.mockResolvedValue([{ id: 'document-1' }])
    resetInsideTriggerRunForTests()
    mockBatchTrigger.mockResolvedValue({ batchId: 'batch-1' })
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

    expect(result).toEqual({ requested: 1, accepted: 1, failed: 0 })
  })

  it('does not dispatch when a different request owns the queue generation', async () => {
    markInsideTriggerRun()
    dbChainMockFns.returning.mockResolvedValueOnce([]).mockResolvedValueOnce([])

    const result = await processDocumentsWithQueue(
      [DOCUMENT],
      'knowledge-base-1',
      {},
      'request-1',
      BILLING_ATTRIBUTION
    )

    expect(result).toEqual({ requested: 1, accepted: 1, failed: 0 })
    expect(mockBatchTrigger).not.toHaveBeenCalled()
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

    expect(result).toEqual({ requested: 1, accepted: 1, failed: 0 })
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

    const resumeGuard = dbChainMockFns.where.mock.calls.find((call) =>
      hasMockCondition(
        call[0],
        (node: MockCondition) =>
          node.type === 'eq' &&
          node.left === schemaMock.document.processingQueueToken &&
          node.right === 'request-1'
      )
    )?.[0]
    expect(resumeGuard).toBeDefined()
    expect(
      hasMockCondition(
        resumeGuard,
        (node: MockCondition) =>
          node.type === 'isNotNull' && node.column === schemaMock.document.processingQueuedAt
      )
    ).toBe(true)
    const statusGuard = flattenMockConditions(resumeGuard).find(
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

  it('keeps a failed same-request replay retryable without clearing its prior stamp', async () => {
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

  it('reports only successful same-request replay dispatches in a partial batch', async () => {
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

    expect(result).toEqual({ requested: 1001, accepted: 1000, failed: 1 })
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

    expect(result).toEqual({ requested: 2, accepted: 2, failed: 0 })
    expect(mockBatchTrigger.mock.calls[0][1].map((job) => job.payload.documentId)).toEqual([
      'document-1',
      'document-2',
    ])
  })

  it('returns an empty dispatch summary without resolving billing context', async () => {
    await expect(
      processDocumentsWithQueue([], 'missing-knowledge-base', {}, 'request-1', undefined)
    ).resolves.toEqual({ requested: 0, accepted: 0, failed: 0 })

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

  it('does not dispatch via Trigger.dev outside a run when the secret key is missing', async () => {
    setEnvFlags({ isTriggerDevEnabled: true })

    await expect(
      processDocumentsWithQueue(
        [DOCUMENT],
        'knowledge-base-1',
        {},
        'request-1',
        BILLING_ATTRIBUTION
      )
    ).rejects.toThrow()

    expect(mockBatchTrigger).not.toHaveBeenCalled()
  })

  it('does not dispatch via Trigger.dev outside a run when the deployment flag is off', async () => {
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
    ).rejects.toThrow()

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
    for (const key of Object.keys(env)) {
      delete (env as Record<string, unknown>)[key]
    }
    Object.assign(env, { ...defaultMockEnv, TRIGGER_SECRET_KEY: 'trigger-secret' })
    dbChainMockFns.limit.mockResolvedValue([
      { userId: 'knowledge-owner', workspaceId: 'workspace-1' },
    ])
  })

  it('refunds the attempt in the same write that withdraws the queue stamp', async () => {
    mockBatchTrigger.mockRejectedValue(new Error('trigger.dev region unavailable'))

    await expect(
      processDocumentsWithQueue(
        [DOCUMENT],
        'knowledge-base-1',
        {},
        'request-1',
        BILLING_ATTRIBUTION
      )
    ).rejects.toThrow('document processing dispatches failed')

    const withdrawCall = dbChainMockFns.set.mock.calls.find(
      (call) => (call[0] as Record<string, unknown> | undefined)?.processingQueuedAt === null
    )
    expect(withdrawCall).toBeDefined()

    const values = withdrawCall?.[0] as Record<string, unknown>
    const attempts = values.processingAttempts as { toSQL: () => { sql: string } } | undefined
    expect(attempts).toBeDefined()
    // Given back as a SQL decrement in the same guarded statement as the stamp,
    // so it can only ever undo the charge this call made.
    expect(attempts?.toSQL().sql).toContain('- 1')
    // Floored, so a refund can never drive the count below zero.
    expect(attempts?.toSQL().sql).toContain('GREATEST')
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
