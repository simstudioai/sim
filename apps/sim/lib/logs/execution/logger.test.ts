import { usageLog, workflow, workflowExecutionLogs } from '@sim/db/schema'
import {
  dbChainMockFns,
  flattenMockConditions,
  queueTableRows,
  resetDbChainMock,
} from '@sim/testing'
import { isPlainRecord } from '@sim/utils/object'
import { afterAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { recordUsage } from '@/lib/billing/core/usage-log'
import { ExecutionLogger } from '@/lib/logs/execution/logger'
import { SECRET_PROJECTION_VERSION } from '@/lib/logs/execution/trace-store'
import type { WorkflowExecutionLog } from '@/lib/logs/types'
import { emitExecutionCompletedEvent } from '@/lib/workspace-events/emitter'
import type { SerializableExecutionState } from '@/executor/execution/types'

afterAll(resetDbChainMock)

/** Flat logger whose withMetadata() children share one spy set, so log level is assertable. */
const { mockLogger, statsLogErrorMock } = vi.hoisted(() => {
  const mockLogger: Record<string, ReturnType<typeof vi.fn>> = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
  }
  mockLogger.child = vi.fn(() => mockLogger)
  mockLogger.withMetadata = vi.fn(() => mockLogger)
  return { mockLogger, statsLogErrorMock: mockLogger.error }
})

vi.mock('@sim/logger', () => ({
  createLogger: vi.fn(() => mockLogger),
  logger: mockLogger,
  runWithRequestContext: vi.fn(<T>(_ctx: unknown, fn: () => T): T => fn()),
  getRequestContext: vi.fn(() => undefined),
}))

// Mock billing modules
vi.mock('@/lib/billing/core/subscription', () => ({
  getHighestPriorityPersonalSubscription: vi.fn(() => Promise.resolve(null)),
  getHighestPrioritySubscription: vi.fn(() => Promise.resolve(null)),
}))

vi.mock('@/lib/billing/core/billing-attribution', () => ({
  resolveBillingAttribution: vi.fn(
    ({ actorUserId, workspaceId }: { actorUserId: string; workspaceId: string }) =>
      Promise.resolve({
        actorUserId,
        workspaceId,
        billedAccountUserId: 'payer-1',
        organizationId: 'org-1',
        billingEntity: { type: 'organization', id: 'org-1' },
        billingPeriod: {
          start: '2024-01-01T00:00:00.000Z',
          end: '2024-02-01T00:00:00.000Z',
        },
        payerSubscription: null,
      })
  ),
  toBillingContext: vi.fn((attribution) => ({
    billingEntity: attribution.billingEntity,
    billingPeriod: {
      start: new Date(attribution.billingPeriod.start),
      end: new Date(attribution.billingPeriod.end),
    },
  })),
}))

vi.mock('@/lib/billing/calculations/usage-monitor', () => ({
  checkUsageStatus: vi.fn(() =>
    Promise.resolve({
      limit: 100,
      percentUsed: 50,
      currentUsage: 50,
      isExceeded: false,
      isWarning: false,
      scope: 'user',
      organizationId: null,
    })
  ),
}))

vi.mock('@/lib/billing/core/usage', () => ({
  getOrgUsageLimit: vi.fn(() => Promise.resolve({ limit: 1000 })),
  maybeSendUsageThresholdEmail: vi.fn(() => Promise.resolve()),
}))

vi.mock('@/lib/billing/core/usage-log', () => ({
  recordUsage: vi.fn(() => Promise.resolve()),
  stableEventKey: vi.fn((parts: Record<string, unknown>) => JSON.stringify(parts)),
  deriveBillingContext: vi.fn((userId: string) => ({
    billingEntity: { type: 'user', id: userId },
    billingPeriod: { start: new Date('2024-01-01'), end: new Date('2024-02-01') },
  })),
}))

vi.mock('@/lib/billing/threshold-billing', () => ({
  checkAndBillOverageThreshold: vi.fn(() => Promise.resolve()),
  checkAndBillPayerOverageThreshold: vi.fn(() => Promise.resolve()),
}))

// Mock security module
vi.mock('@/lib/core/security/redaction', () => ({
  redactApiKeys: vi.fn((data) => data),
}))

// Mock display filters
vi.mock('@/lib/core/utils/display-filters', () => ({
  filterForDisplay: vi.fn((data) => data),
}))

// Mock workspace event emission
vi.mock('@/lib/workspace-events/emitter', () => ({
  emitExecutionCompletedEvent: vi.fn(() => Promise.resolve()),
}))

vi.mock('@/lib/logs/execution/progress-markers', () => ({
  clearProgressMarkers: vi.fn(() => Promise.resolve()),
  getProgressMarkers: vi.fn(() => Promise.resolve(null)),
  pickLatestCompletedMarker: vi.fn((current, persisted) => current ?? persisted),
  pickLatestStartedMarker: vi.fn((current, persisted) => current ?? persisted),
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
    resetDbChainMock()
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

    test('marks new execution rows as contract-aware before any provenance is available', async () => {
      dbChainMockFns.limit.mockResolvedValueOnce([])
      dbChainMockFns.returning.mockResolvedValueOnce([
        {
          id: 'log-1',
          workflowId: 'workflow-123',
          executionId: 'execution-123',
          stateSnapshotId: 'snapshot-123',
          level: 'info',
          trigger: 'api',
          startedAt: new Date('2026-08-04T00:00:00.000Z'),
          endedAt: null,
          totalDurationMs: null,
          executionData: {},
          createdAt: new Date('2026-08-04T00:00:00.000Z'),
        },
      ])

      await logger.startWorkflowExecution({
        workflowId: 'workflow-123',
        workspaceId: 'workspace-123',
        executionId: 'execution-123',
        trigger: {
          type: 'api',
          source: 'api',
          timestamp: '2026-08-04T00:00:00.000Z',
        },
        environment: {
          variables: {},
          workflowId: 'workflow-123',
          executionId: 'execution-123',
          userId: 'user-123',
          workspaceId: 'workspace-123',
        },
        workflowState: { blocks: {}, edges: [], loops: {}, parallels: {} },
      })

      expect(dbChainMockFns.values).toHaveBeenCalledWith(
        expect.objectContaining({
          executionData: expect.objectContaining({
            secretProjectionVersion: SECRET_PROJECTION_VERSION,
          }),
        })
      )
    })

    test('preserves a cancellation that wins the completion update race', async () => {
      const startedAt = new Date('2026-08-03T12:00:00.000Z')
      const createdAt = new Date('2026-08-03T12:00:00.000Z')
      const runningLog = {
        id: 'log-1',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        executionId: 'execution-1',
        stateSnapshotId: 'snapshot-1',
        level: 'info',
        status: 'running',
        trigger: 'api',
        startedAt,
        endedAt: null,
        totalDurationMs: null,
        executionData: {},
        createdAt,
      }
      const cancelledLog = {
        ...runningLog,
        status: 'cancelled',
        endedAt: new Date('2026-08-03T12:00:01.000Z'),
        totalDurationMs: 1000,
        executionData: { finalOutput: { cancelled: true } },
      }
      queueTableRows(workflowExecutionLogs, [runningLog])
      queueTableRows(workflowExecutionLogs, [cancelledLog])
      dbChainMockFns.returning.mockResolvedValueOnce([])
      vi.spyOn(logger as any, 'applyPiiRedaction').mockImplementation(
        async (_workspaceId: unknown, payload: unknown) => payload
      )
      vi.spyOn(logger as any, 'recordExecutionUsage').mockResolvedValue(0)

      const result = await logger.completeWorkflowExecution({
        executionId: 'execution-1',
        endedAt: '2026-08-03T12:00:02.000Z',
        totalDurationMs: 2000,
        costSummary: {
          totalCost: 0,
          totalInputCost: 0,
          totalOutputCost: 0,
          totalTokens: 0,
          totalPromptTokens: 0,
          totalCompletionTokens: 0,
          baseExecutionCharge: 0,
          models: {},
        },
        finalOutput: { completed: true },
        traceSpans: [],
      })

      const completionGuard = dbChainMockFns.where.mock.calls
        .flatMap(([condition]) => flattenMockConditions(condition))
        .find(
          (condition) =>
            Array.isArray(condition.strings) &&
            String(Array.from(condition.strings as string[])).includes("!= 'cancelled'")
        )
      expect(completionGuard).toBeDefined()
      expect(result.executionData).toEqual(cancelledLog.executionData)
      expect(emitExecutionCompletedEvent).not.toHaveBeenCalled()
    })

    const EMPTY_STATE = {
      blockStates: {},
      executedBlocks: [],
      blockLogs: [],
      decisions: { router: {}, condition: {} },
      completedLoops: [],
      activeExecutionPath: [],
    }
    const RUN_PROVENANCE = { version: 1, complete: true, entries: [] }

    /**
     * Drives a real completion and returns the `execution_data` actually written.
     * `redactedState` stands in for the PII pass, which either hands back a
     * redacted state or none at all.
     */
    async function completeAndReadWrite(params: {
      executionState?: SerializableExecutionState
      redactedState?: SerializableExecutionState
    }) {
      const startedAt = new Date('2026-08-11T00:00:00.000Z')
      queueTableRows(workflowExecutionLogs, [
        {
          id: 'log-1',
          workflowId: 'workflow-1',
          workspaceId: 'workspace-1',
          executionId: 'execution-1',
          stateSnapshotId: 'snapshot-1',
          level: 'info',
          status: 'running',
          trigger: 'api',
          startedAt,
          endedAt: null,
          totalDurationMs: null,
          executionData: {},
          createdAt: startedAt,
        },
      ])
      dbChainMockFns.returning.mockResolvedValueOnce([
        { id: 'log-1', executionData: {}, startedAt, createdAt: startedAt },
      ])
      const internals = logger as unknown as {
        applyPiiRedaction: (workspaceId: string, payload: Record<string, unknown>) => unknown
        recordExecutionUsage: () => Promise<number>
      }
      vi.spyOn(internals, 'applyPiiRedaction').mockImplementation(
        async (_workspaceId: string, payload: Record<string, unknown>) =>
          Object.hasOwn(params, 'redactedState')
            ? { ...payload, executionState: params.redactedState }
            : payload
      )
      vi.spyOn(internals, 'recordExecutionUsage').mockResolvedValue(0)

      await logger.completeWorkflowExecution({
        executionId: 'execution-1',
        endedAt: '2026-08-11T00:00:02.000Z',
        totalDurationMs: 2000,
        costSummary: {
          totalCost: 0,
          totalInputCost: 0,
          totalOutputCost: 0,
          totalTokens: 0,
          totalPromptTokens: 0,
          totalCompletionTokens: 0,
          baseExecutionCharge: 0,
          models: {},
        },
        finalOutput: { completed: true },
        traceSpans: [],
        ...(params.executionState ? { executionState: params.executionState } : {}),
      })

      return dbChainMockFns.set.mock.calls
        .map(([values]: [{ executionData?: unknown }]) => values?.executionData)
        .find((data): data is Record<string, unknown> => isPlainRecord(data))
    }

    /**
     * The display projection rebuilds its redaction registry from this key.
     * Compaction drops `executionState`, so the run provenance has to reach the
     * row independently of it or truncated runs render as an empty trace.
     */
    test.each([
      ['redaction preserves the state', EMPTY_STATE],
      ['redaction drops the state entirely', undefined],
    ])('lifts run provenance onto the top-level key when %s', async (_case, redactedState) => {
      const written = await completeAndReadWrite({
        executionState: {
          ...EMPTY_STATE,
          resolvedSecretTraceProvenance: RUN_PROVENANCE,
        } as unknown as SerializableExecutionState,
        redactedState: redactedState as SerializableExecutionState | undefined,
      })

      expect(written?.resolvedSecretTraceProvenance).toEqual(RUN_PROVENANCE)
    })

    test('omits the provenance key when the run carried none', async () => {
      const written = await completeAndReadWrite({})

      expect(written).toBeDefined()
      expect(written).not.toHaveProperty('resolvedSecretTraceProvenance')
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
      expect(completedData.secretProjectionVersion).toBe(SECRET_PROJECTION_VERSION)
      expect(completedData.lastStartedBlock?.blockId).toBe('block-start')
      expect(completedData.lastCompletedBlock?.blockId).toBe('block-end')
      expect(completedData.finalizationPath).toBe('completed')
      expect(completedData.completionFailure).toBe('fallback failure')
      expect(completedData.hasTraceSpans).toBe(false)
      expect(completedData.traceSpanCount).toBe(0)
    })

    test('preserves completion-provided billing attribution when the start row is legacy', () => {
      const loggerInstance = new ExecutionLogger() as any
      const billingAttribution = {
        actorUserId: 'external-actor',
        workspaceId: 'workspace-123',
        organizationId: 'org-123',
        billedAccountUserId: 'owner-123',
        billingEntity: { type: 'organization', id: 'org-123' },
        billingPeriod: {
          start: '2026-07-01T00:00:00.000Z',
          end: '2026-08-01T00:00:00.000Z',
        },
        payerSubscription: null,
      }

      const completedData = loggerInstance.buildCompletedExecutionData({
        existingExecutionData: {},
        billingAttribution,
        traceSpans: [],
        finalOutput: {},
        executionCost: {
          tokens: { input: 0, output: 0, total: 0 },
          models: {},
        },
      })

      expect(completedData.billingAttribution).toEqual(billingAttribution)
    })

    test('preserves server-only lifecycle metadata after execution-state PII masking', () => {
      const loggerInstance = new ExecutionLogger() as unknown as {
        preservePrivateExecutionStateMetadata(
          redactedState: SerializableExecutionState | undefined,
          originalState: SerializableExecutionState | undefined
        ): SerializableExecutionState | undefined
      }
      const provenance = {
        version: 1 as const,
        complete: true,
        entries: [{ name: 'API_SECRET', encryptedValue: 'enc:original-ciphertext' }],
      }
      const trustedLargeValueAccess = {
        executionIds: ['execution-1'],
        largeValueKeys: ['execution/workspace-1/workflow-1/execution-1/value.json'],
        fileKeys: ['workspace-1/file-1'],
      }
      const originalState: SerializableExecutionState = {
        blockStates: {},
        executedBlocks: [],
        blockLogs: [],
        decisions: { router: {}, condition: {} },
        completedLoops: [],
        activeExecutionPath: [],
        resolvedSecretTraceProvenance: provenance,
        trustedLargeValueAccess,
      }
      const redactedState: SerializableExecutionState = {
        ...originalState,
        resolvedSecretTraceProvenance: {
          ...provenance,
          entries: [{ name: 'API_SECRET', encryptedValue: '[MASKED]' }],
        },
        trustedLargeValueAccess: {
          executionIds: [],
          largeValueKeys: [],
          fileKeys: [],
        },
      }

      const preserved = loggerInstance.preservePrivateExecutionStateMetadata(
        redactedState,
        originalState
      )

      expect(preserved?.resolvedSecretTraceProvenance).toBe(provenance)
      expect(preserved?.trustedLargeValueAccess).toBe(trustedLargeValueAccess)
      expect(preserved?.blockStates).toEqual(redactedState.blockStates)
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
      expect(compacted.secretProjectionVersion).toBe(SECRET_PROJECTION_VERSION)
      expect(compacted.executionState).toBeUndefined()
      expect(compacted.executionStateSummary).toEqual({
        executedBlockCount: 1,
        blockLogCount: 1,
        completedLoopCount: 0,
        activeExecutionPathLength: 0,
        pendingQueueLength: 0,
      })
      expect(compacted.traceSpans?.[0]?.children?.[0]).not.toHaveProperty('input')
    })

    test('retains the trusted Copilot binding in metadata-only compaction', () => {
      const loggerInstance = new ExecutionLogger() as unknown as {
        compactExecutionDataForStorage(
          executionData: WorkflowExecutionLog['executionData'],
          executionId: string
        ): WorkflowExecutionLog['executionData']
      }
      const correlation = {
        executionId: 'execution-metadata-only',
        requestId: 'request-1',
        source: 'workflow' as const,
        workflowId: 'workflow-1',
        copilotToolCallId: 'tool-call-1',
      }

      const compacted = loggerInstance.compactExecutionDataForStorage(
        {
          environment: {
            variables: { OVERSIZED: 'x'.repeat(3.5 * 1024 * 1024) },
            workflowId: 'workflow-1',
            executionId: 'execution-metadata-only',
            userId: 'user-1',
            workspaceId: 'workspace-1',
          },
          correlation,
          secretProjectionVersion: SECRET_PROJECTION_VERSION,
          hasTraceSpans: false,
          traceSpanCount: 0,
        },
        'execution-metadata-only'
      )

      expect(compacted.executionDataTruncated).toBe(true)
      expect(compacted.secretProjectionVersion).toBe(SECRET_PROJECTION_VERSION)
      expect(compacted.correlation).toEqual(correlation)
      expect(compacted).not.toHaveProperty('environment')
    })

    test('retains tool-call structure when aggregate trace content exceeds the compaction cap', () => {
      const loggerInstance = new ExecutionLogger() as unknown as {
        compactExecutionDataForStorage(
          executionData: WorkflowExecutionLog['executionData'],
          executionId: string
        ): WorkflowExecutionLog['executionData']
      }
      const oversizedContent = 'x'.repeat(9_000)
      const modelToolCalls = Array.from({ length: 200 }, (_, index) => ({
        id: `model-call-${index}-${'m'.repeat(40)}`,
        name: 'lookup',
        arguments: oversizedContent,
      }))
      const toolCalls = Array.from({ length: 200 }, (_, index) => ({
        id: `legacy-call-${index}-${'l'.repeat(40)}`,
        name: 'legacy_lookup',
        duration: 1,
        startTime: '2025-01-01T00:00:00.000Z',
        endTime: '2025-01-01T00:00:00.001Z',
        status: 'success' as const,
        input: oversizedContent,
        output: oversizedContent,
        error: oversizedContent,
      }))

      const compacted = loggerInstance.compactExecutionDataForStorage(
        {
          traceSpans: [
            {
              id: 'span-1',
              name: 'Agent',
              type: 'agent',
              duration: 1,
              startTime: '2025-01-01T00:00:00.000Z',
              endTime: '2025-01-01T00:00:00.001Z',
              status: 'success',
              modelToolCalls,
              toolCalls,
            },
          ],
          finalOutput: { data: 'y'.repeat(1_100_000) },
        },
        'execution-tool-structure'
      )

      expect(compacted.executionDataTruncated).toBe(true)
      expect(compacted.traceSpans?.[0]?.modelToolCalls).toHaveLength(modelToolCalls.length)
      expect(compacted.traceSpans?.[0]?.modelToolCalls?.[0]).toEqual({
        id: modelToolCalls[0].id,
        name: 'lookup',
      })
      expect(compacted.traceSpans?.[0]?.toolCalls).toHaveLength(toolCalls.length)
      expect(compacted.traceSpans?.[0]?.toolCalls?.[0]).toEqual(
        expect.objectContaining({
          id: toolCalls[0].id,
          name: 'legacy_lookup',
          status: 'success',
        })
      )
      expect(compacted.traceSpans?.[0]?.toolCalls?.[0]).not.toHaveProperty('input')
      expect(compacted.traceSpans?.[0]?.toolCalls?.[0]).not.toHaveProperty('output')
      expect(compacted.traceSpans?.[0]?.toolCalls?.[0]).not.toHaveProperty('error')
    })

    const PROVENANCE = { version: 1, complete: true, entries: [] } as const

    function buildSpans(spanCount: number, ioBytes: number) {
      const payload = 'x'.repeat(ioBytes)
      return Array.from({ length: spanCount }, (_unused, index) => ({
        id: `span-${index}`,
        name: `Block ${index}`,
        type: 'function',
        duration: 1,
        startTime: '2025-01-01T00:00:00.000Z',
        endTime: '2025-01-01T00:00:01.000Z',
        status: 'success' as const,
        output: { data: payload },
      }))
    }

    function compactWithProvenance(traceSpans: unknown[], finalOutput: unknown) {
      const loggerInstance = new ExecutionLogger() as unknown as {
        compactExecutionDataForStorage: (
          data: Record<string, unknown>,
          executionId: string
        ) => Record<string, unknown>
      }
      return loggerInstance.compactExecutionDataForStorage(
        {
          secretProjectionVersion: SECRET_PROJECTION_VERSION,
          resolvedSecretTraceProvenance: PROVENANCE,
          hasTraceSpans: true,
          traceSpanCount: traceSpans.length,
          finalOutput,
          executionState: {
            blockStates: {},
            executedBlocks: [],
            blockLogs: [],
            decisions: { router: {}, condition: {} },
            completedLoops: [],
            activeExecutionPath: [],
            resolvedSecretTraceProvenance: PROVENANCE,
          },
          traceSpans,
        },
        'execution-provenance'
      )
    }

    test('preserves run provenance through the summarized compaction tier', () => {
      // One oversized value: summarization alone brings the row under the cap.
      const compacted = compactWithProvenance(buildSpans(1, 4 * 1024 * 1024), {
        data: 'x'.repeat(4 * 1024 * 1024),
      })

      expect(compacted.executionDataTruncated).toBe(true)
      expect(compacted.executionDataTruncationReason).toContain('were summarized')
      expect(compacted.executionState).toBeUndefined()
      expect(compacted.resolvedSecretTraceProvenance).toEqual(PROVENANCE)
    })

    test('drops run provenance from the metadata-only tier, which stores no spans', () => {
      // That tier keeps no traceSpans, so provenance there buys nothing and
      // would put an unbounded value in the last-resort size floor.
      const compacted = compactWithProvenance(buildSpans(20_000, 8), {})

      expect(compacted.executionDataTruncationReason).toContain('only execution metadata')
      expect(compacted.traceSpans).toBeUndefined()
      expect(compacted.resolvedSecretTraceProvenance).toBeUndefined()
    })

    test('preserves run provenance through the minimal compaction tier', () => {
      // Many spans whose IO each sits under MAX_TRACE_IO_BYTES survive
      // summarization, so only the IO-stripping minimal tier fits the cap.
      const compacted = compactWithProvenance(buildSpans(1200, 4 * 1024), {})

      expect(compacted.executionDataTruncated).toBe(true)
      expect(compacted.executionDataTruncationReason).toContain('details were omitted')
      expect(compacted.executionState).toBeUndefined()
      expect(compacted.resolvedSecretTraceProvenance).toEqual(PROVENANCE)
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
    resetDbChainMock()
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
  const billingContext = {
    billingEntity: { type: 'organization' as const, id: 'org-1' },
    billingPeriod: {
      start: new Date('2026-07-01T00:00:00.000Z'),
      end: new Date('2026-08-01T00:00:00.000Z'),
    },
  }

  // recordExecutionUsage reads two tables: the workflow row (from(workflow)
  // ... .limit(1)), then the already-billed usage_log rows (from(usageLog)
  // ... .groupBy(...)). Route each result set by its table.
  const mockDb = (billedRows: Array<Record<string, unknown>>) => {
    queueTableRows(workflow, [{ id: 'workflow-1', workspaceId: 'ws-1' }])
    queueTableRows(usageLog, billedRows)
  }

  const run = (
    summary: ReturnType<typeof costSummary>,
    billedRows: Array<Record<string, unknown>>
  ) => {
    mockDb(billedRows)
    return logger.recordExecutionUsage(
      'workflow-1',
      summary,
      'api',
      'exec-1',
      'user-1',
      billingContext
    )
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
      expect.objectContaining({
        category: 'fixed',
        source: 'workflow',
        description: 'execution_fee',
        cost: 0.005,
      }),
      expect.objectContaining({
        category: 'model',
        source: 'workflow',
        description: 'gpt-4o',
        cost: 1,
      }),
    ])
    // Returns the amount recorded at this boundary (drives threshold-email math).
    expect(recorded).toBeCloseTo(1.005, 8)
    // cost_total is refined to the exact ledger sum inside the locked tx.
    expect(dbChainMockFns.update).toHaveBeenCalledTimes(1)
  })

  test('leaves Mothership model spend to cumulative update-cost while ledgering ordinary models', async () => {
    const setCostTotalMock = vi.fn(() => ({ where: () => Promise.resolve() }))
    dbChainMockFns.update.mockReturnValueOnce({ set: setCostTotalMock })

    const recorded = await run(
      costSummary({
        totalCost: 1.505,
        models: {
          mothership: {
            total: 0.5,
            input: 0.2,
            output: 0.3,
            tokens: { input: 200, output: 300, total: 500 },
          },
          'gpt-4o': {
            total: 1,
            input: 0.4,
            output: 0.6,
            tokens: { input: 400, output: 600, total: 1000 },
          },
        },
        workflowLedgerModels: {
          'gpt-4o': {
            total: 1,
            input: 0.4,
            output: 0.6,
            tokens: { input: 400, output: 600, total: 1000 },
          },
        },
      }),
      []
    )

    expect(lastEntries()).toEqual([
      expect.objectContaining({ category: 'fixed', description: 'execution_fee', cost: 0.005 }),
      expect.objectContaining({ category: 'model', description: 'gpt-4o', cost: 1 }),
    ])
    expect(lastEntries()).not.toContainEqual(
      expect.objectContaining({ category: 'model', description: 'mothership' })
    )
    expect(recorded).toBeCloseTo(1.005, 8)
    expect(setCostTotalMock).toHaveBeenCalledWith({ costTotal: '1.505' })
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

  test('does not derive an actor payer when workspace billing context is missing', async () => {
    mockDb([])

    const recorded = await (logger as any).recordExecutionUsage(
      'workflow-1',
      costSummary(),
      'api',
      'exec-1',
      'user-1'
    )

    expect(recorded).toBe(0)
    expect(recordUsage).not.toHaveBeenCalled()
  })

  const unbilledErrorCalls = () =>
    mockLogger.error.mock.calls.filter((call) =>
      String(call[0]).includes('Failed to record execution usage to usage_log ledger')
    )

  test('a structurally zero-cost run without billing context logs no unbilled-charge error', async () => {
    mockDb([])

    const recorded = await logger.recordExecutionUsage(
      'workflow-1',
      costSummary({ baseExecutionCharge: 0 }),
      'api',
      'exec-1',
      'user-1'
    )

    expect(recorded).toBe(0)
    expect(recordUsage).not.toHaveBeenCalled()
    expect(unbilledErrorCalls()).toHaveLength(0)
  })

  test('a genuine ledger write failure still logs the unbilled-charge error', async () => {
    vi.mocked(recordUsage).mockRejectedValueOnce(new Error('ledger insert failed'))

    const recorded = await run(costSummary(), [])

    expect(recorded).toBe(0)
    expect(unbilledErrorCalls()).toHaveLength(1)
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
    expect(dbChainMockFns.execute).toHaveBeenCalledTimes(2)
    expect(recordUsage).toHaveBeenCalledTimes(1)
    // The ledger INSERT participates in the locked transaction.
    expect(vi.mocked(recordUsage).mock.calls[0][0]).toHaveProperty('tx')
  })

  test('reports the driver cause and SQLSTATE when the ledger write fails', async () => {
    const driver = Object.assign(new Error('cannot execute INSERT in a read-only transaction'), {
      code: '25006',
    })
    vi.mocked(recordUsage).mockRejectedValueOnce(
      new Error('Failed query: insert into "usage_log"\nparams: user-1', { cause: driver })
    )

    await run(
      costSummary({
        models: {
          'gpt-4o': { input: 0, output: 0, total: 1, tokens: { input: 0, output: 0, total: 0 } },
        },
      }),
      []
    )

    expect(statsLogErrorMock).toHaveBeenCalledWith(
      'Failed to record execution usage to usage_log ledger; charge may be unbilled',
      expect.objectContaining({
        cause: expect.objectContaining({
          code: '25006',
          message: 'cannot execute INSERT in a read-only transaction',
        }),
      })
    )
  })
})
