import { featureFlagsMock } from '@sim/testing'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { recordUsage } from '@/lib/billing/core/usage-log'
import { ExecutionLogger } from '@/lib/logs/execution/logger'

const dbSelectMock = vi.hoisted(() => vi.fn())
const dbExecuteMock = vi.hoisted(() => vi.fn())
const txUpdateMock = vi.hoisted(() =>
  vi.fn(() => ({ set: () => ({ where: () => Promise.resolve() }) }))
)

vi.mock('@sim/db', () => {
  // The reconcile runs inside db.transaction with an advisory lock. The tx
  // shares dbSelectMock so the existing call-order seeding (call 1 = workflow
  // row via .limit, call 2 = already-billed via .groupBy) still applies;
  // tx.execute (set_config + pg_advisory_xact_lock) is a no-op; tx.update backs
  // the exact cost_total refine.
  const tx = {
    select: dbSelectMock,
    insert: vi.fn(),
    update: txUpdateMock,
    execute: dbExecuteMock,
  }
  return {
    db: {
      select: dbSelectMock,
      insert: vi.fn(),
      update: vi.fn(),
      execute: dbExecuteMock,
      transaction: vi.fn(async (cb: (txArg: typeof tx) => Promise<unknown>) => cb(tx)),
    },
  }
})

// Mock billing modules
vi.mock('@/lib/billing/core/subscription', () => ({
  getHighestPrioritySubscription: vi.fn(() => Promise.resolve(null)),
}))

vi.mock('@/lib/billing/core/usage', () => ({
  checkUsageStatus: vi.fn(() =>
    Promise.resolve({
      usageData: { limit: 100, percentUsed: 50, currentUsage: 50 },
    })
  ),
  getOrgUsageLimit: vi.fn(() => Promise.resolve({ limit: 1000 })),
  maybeSendUsageThresholdEmail: vi.fn(() => Promise.resolve()),
}))

vi.mock('@/lib/billing/core/usage-log', () => ({
  recordUsage: vi.fn(() => Promise.resolve()),
  stableEventKey: vi.fn((parts: Record<string, unknown>) => JSON.stringify(parts)),
}))

vi.mock('@/lib/billing/threshold-billing', () => ({
  checkAndBillOverageThreshold: vi.fn(() => Promise.resolve()),
}))

vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)

// Mock security module
vi.mock('@/lib/core/security/redaction', () => ({
  redactApiKeys: vi.fn((data) => data),
}))

// Mock display filters
vi.mock('@/lib/core/utils/display-filters', () => ({
  filterForDisplay: vi.fn((data) => data),
}))

// Mock events
vi.mock('@/lib/logs/events', () => ({
  emitWorkflowExecutionCompleted: vi.fn(() => Promise.resolve()),
}))

// Mock snapshot service
vi.mock('@/lib/logs/execution/snapshot/service', () => ({
  snapshotService: {
    createSnapshotWithDeduplication: vi.fn(() =>
      Promise.resolve({
        snapshot: {
          id: 'snapshot-123',
          workflowId: 'workflow-123',
          stateHash: 'hash-123',
          stateData: { blocks: {}, edges: [], loops: {}, parallels: {} },
          createdAt: '2024-01-01T00:00:00.000Z',
        },
        isNew: true,
      })
    ),
    getSnapshot: vi.fn(() =>
      Promise.resolve({
        id: 'snapshot-123',
        workflowId: 'workflow-123',
        stateHash: 'hash-123',
        stateData: { blocks: {}, edges: [], loops: {}, parallels: {} },
        createdAt: '2024-01-01T00:00:00.000Z',
      })
    ),
  },
}))

describe('ExecutionLogger', () => {
  let logger: ExecutionLogger

  beforeEach(() => {
    logger = new ExecutionLogger()
    vi.clearAllMocks()
  })

  describe('class instantiation', () => {
    test('should create logger instance', () => {
      expect(logger).toBeDefined()
      expect(logger).toBeInstanceOf(ExecutionLogger)
    })
  })

  describe('interface implementation', () => {
    test('should have startWorkflowExecution method', () => {
      expect(typeof logger.startWorkflowExecution).toBe('function')
    })

    test('should have completeWorkflowExecution method', () => {
      expect(typeof logger.completeWorkflowExecution).toBe('function')
    })

    test('should have getWorkflowExecution method', () => {
      expect(typeof logger.getWorkflowExecution).toBe('function')
    })

    test('preserves correlation and diagnostics when execution completes', () => {
      const loggerInstance = new ExecutionLogger() as any

      const completedData = loggerInstance.buildCompletedExecutionData({
        existingExecutionData: {
          environment: {
            variables: {},
            workflowId: 'workflow-123',
            executionId: 'execution-123',
            userId: 'user-123',
            workspaceId: 'workspace-123',
          },
          trigger: {
            type: 'webhook',
            source: 'webhook',
            timestamp: '2025-01-01T00:00:00.000Z',
            data: {
              correlation: {
                executionId: 'execution-123',
                requestId: 'req-1234',
                source: 'webhook',
                workflowId: 'workflow-123',
                webhookId: 'webhook-123',
                path: 'incoming/slack',
                triggerType: 'webhook',
              },
            },
          },
          lastStartedBlock: {
            blockId: 'block-start',
            blockName: 'Start',
            blockType: 'agent',
            startedAt: '2025-01-01T00:00:00.000Z',
          },
          lastCompletedBlock: {
            blockId: 'block-end',
            blockName: 'Finish',
            blockType: 'api',
            endedAt: '2025-01-01T00:00:05.000Z',
            success: true,
          },
        },
        traceSpans: [],
        finalOutput: { ok: true },
        finalizationPath: 'completed',
        completionFailure: 'fallback failure',
        executionCost: {
          tokens: { input: 0, output: 0, total: 0 },
          models: {},
        },
      })

      expect(completedData.environment?.workflowId).toBe('workflow-123')
      expect(completedData.trigger?.data?.correlation).toEqual({
        executionId: 'execution-123',
        requestId: 'req-1234',
        source: 'webhook',
        workflowId: 'workflow-123',
        webhookId: 'webhook-123',
        path: 'incoming/slack',
        triggerType: 'webhook',
      })
      expect(completedData.correlation).toEqual(completedData.trigger?.data?.correlation)
      expect(completedData.finalOutput).toEqual({ ok: true })
      expect(completedData.lastStartedBlock?.blockId).toBe('block-start')
      expect(completedData.lastCompletedBlock?.blockId).toBe('block-end')
      expect(completedData.finalizationPath).toBe('completed')
      expect(completedData.completionFailure).toBe('fallback failure')
      expect(completedData.hasTraceSpans).toBe(false)
      expect(completedData.traceSpanCount).toBe(0)
    })

    test('summarizes oversized execution data before storage', () => {
      const loggerInstance = new ExecutionLogger() as any
      const largePayload = 'x'.repeat(1_100_000)
      const executionState = {
        blockStates: {
          blockA: {
            output: { data: largePayload },
            executed: true,
            executionTime: 10,
          },
        },
        executedBlocks: ['blockA'],
        blockLogs: [
          {
            blockId: 'blockA',
            blockName: 'HTTP',
            blockType: 'api',
            startedAt: '2025-01-01T00:00:00.000Z',
            endedAt: '2025-01-01T00:00:01.000Z',
            durationMs: 1000,
            success: true,
            executionOrder: 1,
            input: { url: 'https://example.com/image.jpg', data: largePayload },
            output: { data: largePayload },
          },
        ],
        decisions: { router: {}, condition: {} },
        completedLoops: [],
        activeExecutionPath: [],
      }

      const completedData = loggerInstance.buildCompletedExecutionData({
        traceSpans: [
          {
            id: 'workflow-execution',
            name: 'Workflow Execution',
            type: 'workflow',
            duration: 1000,
            startTime: '2025-01-01T00:00:00.000Z',
            endTime: '2025-01-01T00:00:01.000Z',
            status: 'success',
            children: [
              {
                id: 'blockA-1',
                name: 'HTTP',
                type: 'api',
                duration: 1000,
                startTime: '2025-01-01T00:00:00.000Z',
                endTime: '2025-01-01T00:00:01.000Z',
                status: 'success',
                blockId: 'blockA',
                executionOrder: 1,
                input: { url: 'https://example.com/image.jpg', data: largePayload },
                output: { data: largePayload },
              },
            ],
          },
        ],
        finalOutput: { data: largePayload },
        executionState,
        finalizationPath: 'completed',
        executionCost: {
          tokens: { input: 0, output: 0, total: 0 },
          models: {},
        },
      })

      const compacted = loggerInstance.compactExecutionDataForStorage(
        completedData,
        'execution-oversized'
      )
      const storedBytes = Buffer.byteLength(JSON.stringify(compacted), 'utf8')

      expect(storedBytes).toBeLessThanOrEqual(3 * 1024 * 1024)
      expect(compacted.executionDataTruncated).toBe(true)
      expect(compacted.executionState).toBeUndefined()
      expect(compacted.executionStateSummary).toEqual({
        executedBlockCount: 1,
        blockLogCount: 1,
        completedLoopCount: 0,
        activeExecutionPathLength: 0,
        pendingQueueLength: 0,
      })
      expect(compacted.traceSpans?.[0]?.children?.[0]?.input).toEqual({
        _truncated: true,
        reason: 'execution_data_size_limit',
        originalBytes: expect.any(Number),
        summary: 'object with 2 keys',
      })
    })
  })

  describe('file extraction', () => {
    test('should extract files from trace spans with files property', () => {
      const loggerInstance = new ExecutionLogger()

      // Access the private method through the class prototype
      const extractFilesMethod = (loggerInstance as any).extractFilesFromExecution.bind(
        loggerInstance
      )

      const traceSpans = [
        {
          id: 'span-1',
          output: {
            files: [
              {
                id: 'file-1',
                name: 'test.pdf',
                size: 1024,
                type: 'application/pdf',
                url: 'https://example.com/file.pdf',
                key: 'uploads/file.pdf',
              },
            ],
          },
        },
      ]

      const files = extractFilesMethod(traceSpans, null, null)
      expect(files).toHaveLength(1)
      expect(files[0].name).toBe('test.pdf')
      expect(files[0].id).toBe('file-1')
    })

    test('should extract files from attachments property', () => {
      const loggerInstance = new ExecutionLogger()
      const extractFilesMethod = (loggerInstance as any).extractFilesFromExecution.bind(
        loggerInstance
      )

      const traceSpans = [
        {
          id: 'span-1',
          output: {
            attachments: [
              {
                id: 'attach-1',
                name: 'attachment.docx',
                size: 2048,
                type: 'application/docx',
                url: 'https://example.com/attach.docx',
                key: 'attachments/attach.docx',
              },
            ],
          },
        },
      ]

      const files = extractFilesMethod(traceSpans, null, null)
      expect(files).toHaveLength(1)
      expect(files[0].name).toBe('attachment.docx')
    })

    test('should deduplicate files with same ID', () => {
      const loggerInstance = new ExecutionLogger()
      const extractFilesMethod = (loggerInstance as any).extractFilesFromExecution.bind(
        loggerInstance
      )

      const duplicateFile = {
        id: 'file-1',
        name: 'test.pdf',
        size: 1024,
        type: 'application/pdf',
        url: 'https://example.com/file.pdf',
        key: 'uploads/file.pdf',
      }

      const traceSpans = [
        { id: 'span-1', output: { files: [duplicateFile] } },
        { id: 'span-2', output: { files: [duplicateFile] } },
      ]

      const files = extractFilesMethod(traceSpans, null, null)
      expect(files).toHaveLength(1)
    })

    test('should extract files from final output', () => {
      const loggerInstance = new ExecutionLogger()
      const extractFilesMethod = (loggerInstance as any).extractFilesFromExecution.bind(
        loggerInstance
      )

      const finalOutput = {
        files: [
          {
            id: 'output-file-1',
            name: 'output.txt',
            size: 512,
            type: 'text/plain',
            url: 'https://example.com/output.txt',
            key: 'outputs/output.txt',
          },
        ],
      }

      const files = extractFilesMethod([], finalOutput, null)
      expect(files).toHaveLength(1)
      expect(files[0].name).toBe('output.txt')
    })

    test('should extract files from workflow input', () => {
      const loggerInstance = new ExecutionLogger()
      const extractFilesMethod = (loggerInstance as any).extractFilesFromExecution.bind(
        loggerInstance
      )

      const workflowInput = {
        files: [
          {
            id: 'input-file-1',
            name: 'input.csv',
            size: 256,
            type: 'text/csv',
            url: 'https://example.com/input.csv',
            key: 'inputs/input.csv',
          },
        ],
      }

      const files = extractFilesMethod([], null, workflowInput)
      expect(files).toHaveLength(1)
      expect(files[0].name).toBe('input.csv')
    })

    test('should handle empty inputs', () => {
      const loggerInstance = new ExecutionLogger()
      const extractFilesMethod = (loggerInstance as any).extractFilesFromExecution.bind(
        loggerInstance
      )

      const files = extractFilesMethod(undefined, undefined, undefined)
      expect(files).toHaveLength(0)
    })

    test('should handle deeply nested file objects', () => {
      const loggerInstance = new ExecutionLogger()
      const extractFilesMethod = (loggerInstance as any).extractFilesFromExecution.bind(
        loggerInstance
      )

      const traceSpans = [
        {
          id: 'span-1',
          output: {
            nested: {
              deeply: {
                files: [
                  {
                    id: 'nested-file-1',
                    name: 'nested.json',
                    size: 128,
                    type: 'application/json',
                    url: 'https://example.com/nested.json',
                    key: 'nested/file.json',
                  },
                ],
              },
            },
          },
        },
      ]

      const files = extractFilesMethod(traceSpans, null, null)
      expect(files).toHaveLength(1)
      expect(files[0].name).toBe('nested.json')
    })
  })
})

describe('recordExecutionUsage boundary-delta reconciliation', () => {
  let logger: any

  beforeEach(() => {
    logger = new ExecutionLogger() as any
    vi.clearAllMocks()
  })

  const costSummary = (overrides: Record<string, unknown> = {}) => ({
    totalCost: 0,
    totalInputCost: 0,
    totalOutputCost: 0,
    totalTokens: 0,
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    baseExecutionCharge: 0.005,
    models: {},
    charges: {},
    ...overrides,
  })

  // db.select() is called twice in recordExecutionUsage: first the workflow row
  // (terminated by .limit), then the already-billed usage_log rows (terminated
  // by .groupBy). Return each in order.
  const mockDb = (billedRows: Array<Record<string, unknown>>) => {
    let call = 0
    dbSelectMock.mockImplementation(() => {
      call += 1
      const rows = call === 1 ? [{ id: 'workflow-1', workspaceId: 'ws-1' }] : billedRows
      const chain: any = {
        from: () => chain,
        where: () => chain,
        limit: () => Promise.resolve(rows),
        groupBy: () => Promise.resolve(rows),
      }
      return chain
    })
  }

  const run = (
    summary: ReturnType<typeof costSummary>,
    billedRows: Array<Record<string, unknown>>
  ) => {
    mockDb(billedRows)
    return logger.recordExecutionUsage('workflow-1', summary, 'api', 'exec-1', 'user-1')
  }

  const lastEntries = () => vi.mocked(recordUsage).mock.calls[0][0].entries

  test('fresh completion records all targets (base fee + model) and returns the increment', async () => {
    const recorded = await run(
      costSummary({
        models: {
          'gpt-4o': {
            total: 1,
            input: 0.6,
            output: 0.4,
            tokens: { input: 10, output: 5, total: 15 },
          },
        },
      }),
      []
    )

    expect(recordUsage).toHaveBeenCalledTimes(1)
    expect(lastEntries()).toEqual([
      expect.objectContaining({ category: 'fixed', description: 'execution_fee', cost: 0.005 }),
      expect.objectContaining({ category: 'model', description: 'gpt-4o', cost: 1 }),
    ])
    // Returns the amount recorded at this boundary (drives threshold-email math).
    expect(recorded).toBeCloseTo(1.005, 8)
    // cost_total is refined to the exact ledger sum inside the locked tx.
    expect(txUpdateMock).toHaveBeenCalledTimes(1)
  })

  test('resume records only the increment over what is already billed', async () => {
    await run(
      costSummary({
        models: {
          'gpt-4o': {
            total: 3,
            input: 1.8,
            output: 1.2,
            tokens: { input: 30, output: 15, total: 45 },
          },
        },
      }),
      [
        { category: 'fixed', description: 'execution_fee', cost: '0.005' },
        { category: 'model', description: 'gpt-4o', cost: '1' },
      ]
    )

    expect(recordUsage).toHaveBeenCalledTimes(1)
    const entries = lastEntries()
    expect(entries).toHaveLength(1)
    expect(entries[0]).toEqual(
      expect.objectContaining({ category: 'model', description: 'gpt-4o', cost: 2 })
    )
  })

  test('returns only the post-resume increment (not the cumulative total)', async () => {
    const recorded = await run(
      costSummary({
        models: {
          'gpt-4o': {
            total: 3,
            input: 0,
            output: 0,
            tokens: { input: 0, output: 0, total: 0 },
          },
        },
      }),
      [
        { category: 'fixed', description: 'execution_fee', cost: '0.005' },
        { category: 'model', description: 'gpt-4o', cost: '1' },
      ]
    )
    // Cumulative is 3.005, but only the $2 increment was recorded here — the
    // threshold-email math must not re-count the pre-pause $1.005.
    expect(recorded).toBe(2)
  })

  test('forwards a pre-resolved billing context to recordUsage (skips re-lookup)', async () => {
    mockDb([])
    const billingContext = {
      billingEntity: { type: 'user' as const, id: 'user-1' },
      billingPeriod: { start: new Date('2026-01-01'), end: new Date('2026-02-01') },
    }
    await (logger as any).recordExecutionUsage(
      'workflow-1',
      costSummary({
        models: {
          'gpt-4o': {
            total: 1,
            input: 0,
            output: 0,
            tokens: { input: 0, output: 0, total: 0 },
          },
        },
      }),
      'api',
      'exec-1',
      'user-1',
      billingContext
    )
    expect(vi.mocked(recordUsage).mock.calls[0][0]).toMatchObject({
      billingEntity: { type: 'user', id: 'user-1' },
      billingPeriod: billingContext.billingPeriod,
    })
  })

  test('retry with everything already billed records nothing (idempotent)', async () => {
    await run(
      costSummary({
        models: {
          'gpt-4o': {
            total: 1,
            input: 0.6,
            output: 0.4,
            tokens: { input: 10, output: 5, total: 15 },
          },
        },
      }),
      [
        { category: 'fixed', description: 'execution_fee', cost: '0.005' },
        { category: 'model', description: 'gpt-4o', cost: '1' },
      ]
    )

    expect(recordUsage).not.toHaveBeenCalled()
  })

  test('BYOK run records only the base fee (no zero-cost model rows)', async () => {
    await run(costSummary({ models: {}, charges: {} }), [])

    expect(recordUsage).toHaveBeenCalledTimes(1)
    expect(lastEntries()).toEqual([
      expect.objectContaining({ category: 'fixed', description: 'execution_fee', cost: 0.005 }),
    ])
  })

  test('standalone hosted-tool charge reconciles as a tool row', async () => {
    await run(costSummary({ charges: { 'Exa Search': { total: 0.02 } } }), [
      { category: 'fixed', description: 'execution_fee', cost: '0.005' },
    ])

    expect(lastEntries()).toEqual([
      expect.objectContaining({ category: 'tool', description: 'Exa Search', cost: 0.02 }),
    ])
  })

  test('two boundaries (pause then resume) bill the full run exactly once', async () => {
    const model = (total: number) => ({
      'gpt-4o': {
        input: total * 0.6,
        output: total * 0.4,
        total,
        tokens: { input: 10, output: 5, total: 15 },
      },
    })

    // Boundary 1 (pause): nothing billed yet, partial cost.
    await run(costSummary({ models: model(1) }), [])
    const firstEntries = vi.mocked(recordUsage).mock.calls[0][0].entries

    // Feed boundary 1's rows back as already-billed for boundary 2.
    const billedAfterFirst = firstEntries.map((e: any) => ({
      category: e.category,
      description: e.description,
      cost: String(e.cost),
    }))

    // Boundary 2 (resume terminal): same model, higher cumulative cost.
    await run(costSummary({ models: model(3) }), billedAfterFirst)
    const secondEntries = vi.mocked(recordUsage).mock.calls[1][0].entries

    const ledgerTotal = [...firstEntries, ...secondEntries].reduce(
      (sum: number, e: any) => sum + e.cost,
      0
    )
    expect(ledgerTotal).toBeCloseTo(3.005, 8) // base 0.005 once + gpt-4o 3 total
    // Base fee billed once (boundary 1 only); model increment only at boundary 2.
    expect(firstEntries.some((e: any) => e.category === 'fixed')).toBe(true)
    expect(secondEntries.some((e: any) => e.category === 'fixed')).toBe(false)
    expect(secondEntries).toEqual([
      expect.objectContaining({ category: 'model', description: 'gpt-4o', cost: 2 }),
    ])
  })

  test('eventKey is scoped by billedBefore so cross-boundary increments do not collide', async () => {
    const model = (total: number) => ({
      'gpt-4o': { input: 0, output: 0, total, tokens: { input: 0, output: 0, total: 0 } },
    })

    await run(costSummary({ models: model(1) }), [])
    const key0 = vi
      .mocked(recordUsage)
      .mock.calls[0][0].entries.find((e: any) => e.category === 'model')?.eventKey

    await run(costSummary({ models: model(3) }), [
      { category: 'fixed', description: 'execution_fee', cost: '0.005' },
      { category: 'model', description: 'gpt-4o', cost: '1' },
    ])
    const key1 = vi
      .mocked(recordUsage)
      .mock.calls[1][0].entries.find((e: any) => e.category === 'model')?.eventKey

    expect(key0).toContain('"billedBefore":"0.00000000"')
    expect(key1).toContain('"billedBefore":"1.00000000"')
    expect(key0).not.toEqual(key1)
  })

  test('a decreased cumulative cost (negative delta) records nothing for that line', async () => {
    await run(
      costSummary({
        models: {
          'gpt-4o': { input: 0, output: 0, total: 3, tokens: { input: 0, output: 0, total: 0 } },
        },
      }),
      [
        { category: 'fixed', description: 'execution_fee', cost: '0.005' },
        { category: 'model', description: 'gpt-4o', cost: '5' },
      ]
    )
    expect(recordUsage).not.toHaveBeenCalled()
  })

  test('a model introduced only post-resume is billed in full; the already-billed model is skipped', async () => {
    await run(
      costSummary({
        models: {
          'gpt-4o': { input: 0, output: 0, total: 1, tokens: { input: 0, output: 0, total: 0 } },
          'claude-3': { input: 0, output: 0, total: 2, tokens: { input: 0, output: 0, total: 0 } },
        },
      }),
      [
        { category: 'fixed', description: 'execution_fee', cost: '0.005' },
        { category: 'model', description: 'gpt-4o', cost: '1' },
      ]
    )
    expect(lastEntries()).toEqual([
      expect.objectContaining({ category: 'model', description: 'claude-3', cost: 2 }),
    ])
  })

  test('zero-cost models and charges (BYOK) are filtered out, leaving only the base fee', async () => {
    await run(
      costSummary({
        models: {
          'gpt-4o': { input: 0, output: 0, total: 0, tokens: { input: 0, output: 0, total: 0 } },
        },
        charges: { Exa: { total: 0 } },
      }),
      []
    )
    expect(lastEntries()).toEqual([
      expect.objectContaining({ category: 'fixed', description: 'execution_fee', cost: 0.005 }),
    ])
  })

  test('reconciles inside a transaction holding a per-execution advisory lock', async () => {
    await run(
      costSummary({
        models: {
          'gpt-4o': { input: 0, output: 0, total: 1, tokens: { input: 0, output: 0, total: 0 } },
        },
      }),
      []
    )

    // set_config('lock_timeout') + pg_advisory_xact_lock both run on the tx.
    expect(dbExecuteMock).toHaveBeenCalledTimes(2)
    expect(recordUsage).toHaveBeenCalledTimes(1)
    // The ledger INSERT participates in the locked transaction.
    expect(vi.mocked(recordUsage).mock.calls[0][0]).toHaveProperty('tx')
  })
})
