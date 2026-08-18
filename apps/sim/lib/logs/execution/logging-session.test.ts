/**
 * @vitest-environment node
 */

import { workflowExecutionLogs } from '@sim/db/schema'
import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const dbMocks = vi.hoisted(() => ({
  eq: vi.fn(),
  and: vi.fn((...args: unknown[]) => ({ type: 'and', args })),
  sql: Object.assign(
    vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values })),
    {
      /** `elapsedDurationMsSql` binds `ended_at` through the column's own mapper. */
      param: vi.fn((value: unknown, encoder?: unknown) => ({ value, encoder })),
    }
  ),
}))

const {
  completeWorkflowExecutionMock,
  loadTraceSpansForProjectionMock,
  prepareTraceSpansForProjectionMock,
  startWorkflowExecutionMock,
  loadWorkflowStateForExecutionMock,
  releaseExecutionSlotMock,
  createOTelSpansMock,
  workflowExecutedMock,
} = vi.hoisted(() => ({
  completeWorkflowExecutionMock: vi.fn(),
  loadTraceSpansForProjectionMock: vi.fn(),
  prepareTraceSpansForProjectionMock: vi.fn(),
  startWorkflowExecutionMock: vi.fn(),
  loadWorkflowStateForExecutionMock: vi.fn(),
  releaseExecutionSlotMock: vi.fn(),
  createOTelSpansMock: vi.fn(),
  workflowExecutedMock: vi.fn(),
}))

const { materializeLargeValueRefMock, storeLargeValueMock } = vi.hoisted(() => ({
  materializeLargeValueRefMock: vi.fn(),
  storeLargeValueMock: vi.fn(),
}))

const { decryptSecretMock } = vi.hoisted(() => ({
  decryptSecretMock: vi.fn(async (encryptedValue: string) => ({ decrypted: encryptedValue })),
}))

const { recordSecretUsageMock } = vi.hoisted(() => ({ recordSecretUsageMock: vi.fn() }))
vi.mock('@/lib/secrets/usage/record', () => ({ recordSecretUsage: recordSecretUsageMock }))

vi.mock('drizzle-orm', () => ({
  eq: dbMocks.eq,
  and: dbMocks.and,
  sql: dbMocks.sql,
}))

vi.mock('@/lib/logs/execution/logger', () => ({
  executionLogger: {
    startWorkflowExecution: startWorkflowExecutionMock,
    completeWorkflowExecution: completeWorkflowExecutionMock,
    loadTraceSpansForProjection: loadTraceSpansForProjectionMock,
    prepareTraceSpansForProjection: prepareTraceSpansForProjectionMock,
  },
}))

vi.mock('@/lib/billing/calculations/usage-reservation', () => ({
  releaseExecutionSlot: releaseExecutionSlotMock,
}))

vi.mock('@/lib/core/telemetry', () => ({
  createOTelSpansForWorkflowExecution: createOTelSpansMock,
  PlatformEvents: { workflowExecuted: workflowExecutedMock },
}))

vi.mock('@/lib/execution/payloads/store', () => ({
  materializeLargeValueRef: materializeLargeValueRefMock,
  storeLargeValue: storeLargeValueMock,
}))

vi.mock('@/lib/core/security/encryption', () => ({
  decryptSecret: decryptSecretMock,
}))

const {
  setLastStartedBlockMock,
  setLastCompletedBlockMock,
  getProgressMarkersMock,
  clearProgressMarkersMock,
} = vi.hoisted(() => ({
  setLastStartedBlockMock: vi.fn().mockResolvedValue(false),
  setLastCompletedBlockMock: vi.fn().mockResolvedValue(false),
  getProgressMarkersMock: vi.fn().mockResolvedValue({}),
  clearProgressMarkersMock: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/logs/execution/progress-markers', () => ({
  setLastStartedBlock: setLastStartedBlockMock,
  setLastCompletedBlock: setLastCompletedBlockMock,
  getProgressMarkers: getProgressMarkersMock,
  clearProgressMarkers: clearProgressMarkersMock,
}))

vi.mock('@/lib/logs/execution/logging-factory', () => ({
  calculateCostSummary: vi.fn().mockReturnValue({
    totalCost: 0,
    totalInputCost: 0,
    totalOutputCost: 0,
    totalTokens: 0,
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    baseExecutionCharge: 0,
    models: {},
  }),
  createEnvironmentObject: vi.fn(),
  createTriggerObject: vi.fn((type: string, additionalData?: Record<string, unknown>) => ({
    type,
    source: type,
    timestamp: '2026-01-01T00:00:00.000Z',
    ...(additionalData ? { data: additionalData } : {}),
  })),
  loadDeployedWorkflowStateForLogging: vi.fn(),
  loadWorkflowStateForExecution: loadWorkflowStateForExecutionMock,
}))

import { calculateCostSummary } from '@/lib/logs/execution/logging-factory'
import {
  type ResolvedSecretTraceMatch,
  ResolvedSecretTraceRegistry,
} from '@/executor/utils/resolved-secret-trace-registry'
import { LoggingSession } from './logging-session'

afterAll(resetDbChainMock)

function createSecretRegistry(
  matches: ResolvedSecretTraceMatch[],
  complete = true
): ResolvedSecretTraceRegistry {
  return {
    isComplete: () => complete,
    getActiveMatches: () => matches,
    getResolvedSecretUsage: () => [{ name: 'API_KEY', scope: 'workspace' as const }],
    exportProvenance: () => ({ version: 1, complete, entries: [] }),
    exportCheckpointProvenance: () => ({ version: 1, complete, entries: [] }),
  } as unknown as ResolvedSecretTraceRegistry
}

function createDisplayProvenance(matches: ResolvedSecretTraceMatch[], complete = true) {
  return {
    version: 1 as const,
    complete,
    entries: matches.map(({ plaintext, replacement }) => {
      const namedMatch = /^\{\{(.+)\}\}$/.exec(replacement)
      return {
        encryptedValue: plaintext,
        ...(namedMatch?.[1] ? { name: namedMatch[1] } : {}),
      }
    }),
  }
}

describe('LoggingSession diagnostic projection', () => {
  it('projects execution errors with the run-scoped secret provenance', () => {
    const secret = 'logging-session-secret-7f3a91'
    const error = new Error(`failed ${secret} __var_API_KEY __sim_code_2_binding_1`)
    const session = new LoggingSession('workflow-1', 'execution-1', 'manual')
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'API_KEY', plaintext: secret, encryptedValue: 'encrypted-api-key' },
    ])
    registry.recordResolved('API_KEY', secret)
    session.setResolvedSecretTraceRegistry(registry)

    const diagnostic = session.projectDiagnosticError(error, { workflowId: 'workflow-1' })

    expect(diagnostic).toMatchObject({
      workflowId: 'workflow-1',
      error: 'failed {{API_KEY}} {{API_KEY}} [RUNTIME_BINDING]',
    })
    expect(JSON.stringify(diagnostic)).not.toContain(secret)
    expect(JSON.stringify(diagnostic)).not.toContain('__var_')
    expect(JSON.stringify(diagnostic)).not.toContain('__sim_')
    expect(error.message).toContain(secret)
  })

  it('fails closed when the run-scoped provenance is unavailable', () => {
    const session = new LoggingSession('workflow-1', 'execution-1', 'manual')

    expect(
      session.projectDiagnosticError(new Error('untrusted secret'), {
        workflowId: 'workflow-1',
      })
    ).toEqual({ errorType: 'error', hasStack: true })
  })
})

describe('LoggingSession response provenance', () => {
  it('exports only active secrets present in the settled response without mutating it', () => {
    const session = new LoggingSession('workflow-1', 'execution-1', 'manual')
    const registry = new ResolvedSecretTraceRegistry(
      [
        { name: 'OUTPUT_SECRET', plaintext: 'secret output', encryptedValue: 'encrypted-output' },
        { name: 'UNUSED_SECRET', plaintext: 'public', encryptedValue: 'encrypted-unused' },
      ],
      { userId: 'user-1', workspaceId: 'workspace-1' }
    )
    registry.recordResolved('OUTPUT_SECRET', 'secret output')
    session.setResolvedSecretTraceRegistry(registry)
    const responseBody = { success: false, error: 'failed with secret output', public: 'public' }

    expect(session.exportResolvedSecretTraceProvenanceForValue(responseBody)).toEqual({
      version: 1,
      complete: true,
      entries: [{ name: 'OUTPUT_SECRET', encryptedValue: 'encrypted-output' }],
      scope: { userId: 'user-1', workspaceId: 'workspace-1' },
    })
    expect(responseBody).toEqual({
      success: false,
      error: 'failed with secret output',
      public: 'public',
    })
  })

  it('returns incomplete provenance when the run registry is unavailable', () => {
    const session = new LoggingSession('workflow-1', 'execution-1', 'manual')

    expect(session.exportResolvedSecretTraceProvenanceForValue({ output: 'public' })).toEqual({
      version: 1,
      complete: false,
      entries: [],
    })
  })
})

describe('LoggingSession terminal provenance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    dbChainMockFns.limit.mockResolvedValue([])
    completeWorkflowExecutionMock.mockResolvedValue({})
    releaseExecutionSlotMock.mockResolvedValue(undefined)
  })

  it.each([
    [
      'error',
      (session: LoggingSession) => session.completeWithError({ error: { message: 'failed' } }),
    ],
    ['cancellation', (session: LoggingSession) => session.completeWithCancellation()],
    ['pause', (session: LoggingSession) => session.completeWithPause()],
  ])('persists complete zero-entry provenance on %s finalization', async (_name, finalize) => {
    const session = new LoggingSession('workflow-1', `execution-${_name}`, 'manual')
    session.setResolvedSecretTraceRegistry(createSecretRegistry([]))

    await finalize(session)

    expect(completeWorkflowExecutionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        executionState: expect.objectContaining({
          resolvedSecretTraceProvenance: {
            version: 1,
            complete: true,
            entries: [],
          },
          resolvedSecretTraceCheckpointVersion: 1,
        }),
      })
    )
  })

  it('uses checkpoint provenance rather than a temporary pending egress state on pause', async () => {
    const session = new LoggingSession('workflow-1', 'execution-pending-pause', 'manual')
    session.setResolvedSecretTraceRegistry({
      ...createSecretRegistry([]),
      exportProvenance: () => ({ version: 1, complete: false, entries: [] }),
      exportCheckpointProvenance: () => ({
        version: 1,
        complete: true,
        entries: [{ name: 'TOKEN', encryptedValue: 'ciphertext' }],
      }),
    } as unknown as ResolvedSecretTraceRegistry)

    await session.completeWithPause()

    expect(completeWorkflowExecutionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        executionState: expect.objectContaining({
          resolvedSecretTraceProvenance: {
            version: 1,
            complete: true,
            entries: [{ name: 'TOKEN', encryptedValue: 'ciphertext' }],
          },
          resolvedSecretTraceCheckpointVersion: 1,
        }),
      })
    )
  })

  it('preserves exact workflow input and final output sidecars on completion', async () => {
    const session = new LoggingSession('workflow-1', 'execution-exact-values', 'manual')
    session.setResolvedSecretTraceRegistry(createSecretRegistry([]))
    const exactProvenance = {
      version: 1 as const,
      complete: true,
      entries: [{ name: 'TOKEN', encryptedValue: 'ciphertext' }],
    }
    const executionState = {
      blockStates: {},
      executedBlocks: [],
      blockLogs: [],
      decisions: { router: {}, condition: {} },
      completedLoops: [],
      activeExecutionPath: [],
      workflowInputResolvedSecretTraceProvenance: exactProvenance,
      finalOutputResolvedSecretTraceProvenance: {
        version: 1 as const,
        complete: true,
        entries: [],
      },
    }

    await session.complete({
      finalOutput: { result: 'TestValue' },
      workflowInput: { token: 'TestValue' },
      executionState,
    })

    expect(completeWorkflowExecutionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        executionState: expect.objectContaining({
          workflowInputResolvedSecretTraceProvenance: exactProvenance,
          finalOutputResolvedSecretTraceProvenance:
            executionState.finalOutputResolvedSecretTraceProvenance,
        }),
      })
    )
  })

  it.each(['cancellation', 'pause'] as const)(
    'preserves raw execution state on %s finalization',
    async (finalization) => {
      const session = new LoggingSession('workflow-1', `execution-state-${finalization}`, 'manual')
      session.setResolvedSecretTraceRegistry(createSecretRegistry([]))
      const executionState = {
        blockStates: { 'function-1': { output: { result: 'raw-secret-value' } } },
        executedBlocks: ['function-1'],
        blockLogs: [],
        decisions: { router: {}, condition: {} },
        completedLoops: [],
        activeExecutionPath: ['function-1'],
      }

      if (finalization === 'cancellation') {
        await session.completeWithCancellation({ executionState })
      } else {
        await session.completeWithPause({ executionState })
      }

      expect(completeWorkflowExecutionMock).toHaveBeenCalledWith(
        expect.objectContaining({
          executionState: expect.objectContaining({
            blockStates: executionState.blockStates,
            finalOutputResolvedSecretTraceProvenance: {
              version: 1,
              complete: true,
              entries: [],
            },
            resolvedSecretTraceProvenance: {
              version: 1,
              complete: true,
              entries: [],
            },
          }),
        })
      )
    }
  )
})

beforeEach(() => {
  loadTraceSpansForProjectionMock.mockImplementation(
    async ({ traceSpans }: { traceSpans: unknown[] }) => traceSpans
  )
  prepareTraceSpansForProjectionMock.mockImplementation(
    async ({ traceSpans }: { traceSpans: unknown[] }) => traceSpans
  )
})

describe('LoggingSession start snapshots', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    startWorkflowExecutionMock.mockResolvedValue({})
    loadWorkflowStateForExecutionMock.mockResolvedValue({
      blocks: {
        stale: {
          id: 'stale',
          type: 'function',
          name: 'Stale',
          position: { x: 0, y: 0 },
          subBlocks: {},
          outputs: {},
          enabled: true,
        },
      },
      edges: [],
      loops: {},
      parallels: {},
    })
  })

  it('prefers the explicit actor over a legacy session user', async () => {
    const session = new LoggingSession('workflow-1', 'execution-actor', 'api', 'req-actor')

    await session.start({
      userId: 'legacy-session-user',
      actorUserId: 'authenticated-actor',
      workspaceId: 'workspace-1',
    })

    expect(startWorkflowExecutionMock).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: 'authenticated-actor' })
    )
  })

  it('persists only the server-validated execution correlation', async () => {
    const session = new LoggingSession('workflow-1', 'execution-1', 'copilot', 'req-1')
    const trustedCorrelation = {
      executionId: 'execution-1',
      requestId: 'req-1',
      source: 'workflow',
      workflowId: 'workflow-1',
      triggerType: 'copilot',
      copilotToolCallId: 'trusted-tool-call',
    }
    session.setTrustedExecutionCorrelation(trustedCorrelation)

    await session.start({
      userId: 'user-1',
      workspaceId: 'workspace-1',
      triggerData: {
        correlation: {
          executionId: 'submitted-execution',
          requestId: 'submitted-request',
          source: 'workflow',
          copilotToolCallId: 'submitted-tool-call',
        },
      },
    })

    expect(startWorkflowExecutionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        trigger: expect.objectContaining({
          data: expect.objectContaining({ correlation: trustedCorrelation }),
        }),
      })
    )
  })

  it('does not create a log when hydrating a persisted execution for completion', async () => {
    const session = new LoggingSession('workflow-1', 'execution-existing', 'manual', 'req-existing')

    await session.start({
      userId: 'user-1',
      actorUserId: 'user-1',
      billingAttribution: {
        actorUserId: 'user-1',
        workspaceId: 'workspace-1',
        organizationId: 'org-1',
        billedAccountUserId: 'owner-1',
        billingEntity: { type: 'organization', id: 'org-1' },
        billingPeriod: {
          start: '2026-07-01T00:00:00.000Z',
          end: '2026-08-01T00:00:00.000Z',
        },
        payerSubscription: null,
      },
      workspaceId: 'workspace-1',
      skipLogCreation: true,
    })

    expect(startWorkflowExecutionMock).not.toHaveBeenCalled()
  })

  it('restarts a paused execution with a fresh attempt deadline', async () => {
    const session = new LoggingSession('workflow-1', 'execution-paused', 'manual', 'req-paused')
    const deadline = new Date('2026-08-04T12:00:00.000Z')
    session.setExecutionDeadlineAt(deadline)

    await session.start({
      userId: 'user-1',
      actorUserId: 'user-1',
      billingAttribution: {
        actorUserId: 'user-1',
        workspaceId: 'workspace-1',
        organizationId: 'org-1',
        billedAccountUserId: 'owner-1',
        billingEntity: { type: 'organization', id: 'org-1' },
        billingPeriod: {
          start: '2026-07-01T00:00:00.000Z',
          end: '2026-08-01T00:00:00.000Z',
        },
        payerSubscription: null,
      },
      workspaceId: 'workspace-1',
      skipLogCreation: true,
    })

    expect(dbChainMockFns.set).toHaveBeenCalledWith({
      status: 'running',
      executionDeadlineAt: deadline,
    })
    const [statusSqlParts] = dbMocks.sql.mock.calls[0]
    expect(Array.from(statusSqlParts).join('')).toContain("IN ('pending', 'running', 'paused')")
  })

  it('uses the executed workflow state override for execution snapshots', async () => {
    const session = new LoggingSession('workflow-1', 'execution-1', 'manual', 'req-1')
    const executedWorkflowState = {
      blocks: {
        loop: {
          id: 'loop',
          type: 'loop',
          name: 'Loop',
          position: { x: 0, y: 0 },
          subBlocks: {},
          outputs: {},
          enabled: true,
        },
        parallel: {
          id: 'parallel',
          type: 'parallel',
          name: 'Parallel',
          position: { x: 100, y: 80 },
          subBlocks: {},
          outputs: {},
          enabled: true,
          data: { parentId: 'loop', extent: 'parent' as const },
        },
      },
      edges: [],
      loops: { loop: { id: 'loop', nodes: ['parallel'], iterations: 1, loopType: 'for' as const } },
      parallels: { parallel: { id: 'parallel', nodes: [], count: 1 } },
    }

    await session.start({
      workspaceId: 'workspace-1',
      workflowState: executedWorkflowState,
    })

    expect(loadWorkflowStateForExecutionMock).not.toHaveBeenCalled()
    expect(startWorkflowExecutionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowState: executedWorkflowState,
      })
    )
  })
})

describe('LoggingSession completion retries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    dbChainMockFns.limit.mockResolvedValue([{ executionData: {} }])
  })

  it('keeps completion best-effort when a later error completion retries after full completion and fallback both fail', async () => {
    const session = new LoggingSession('workflow-1', 'execution-1', 'api', 'req-1')

    completeWorkflowExecutionMock
      .mockRejectedValueOnce(new Error('success finalize failed'))
      .mockRejectedValueOnce(new Error('cost only failed'))
      .mockResolvedValueOnce({})

    await expect(session.safeComplete({ finalOutput: { ok: true } })).resolves.toBeUndefined()

    await expect(
      session.safeCompleteWithError({
        error: { message: 'fallback error finalize' },
      })
    ).resolves.toBeUndefined()

    expect(completeWorkflowExecutionMock).toHaveBeenCalledTimes(3)
    expect(session.hasCompleted()).toBe(true)
  })

  it('reuses the settled completion promise for repeated completion attempts', async () => {
    const session = new LoggingSession('workflow-1', 'execution-1', 'api', 'req-1')

    completeWorkflowExecutionMock
      .mockRejectedValueOnce(new Error('success finalize failed'))
      .mockRejectedValueOnce(new Error('cost only failed'))

    await expect(session.safeComplete({ finalOutput: { ok: true } })).resolves.toBeUndefined()
    await expect(session.safeComplete({ finalOutput: { ok: true } })).resolves.toBeUndefined()

    expect(completeWorkflowExecutionMock).toHaveBeenCalledTimes(2)
  })

  it('starts a new error completion attempt after a non-error completion and fallback both fail', async () => {
    const session = new LoggingSession('workflow-1', 'execution-3', 'api', 'req-1')
    session.setResolvedSecretTraceRegistry(createSecretRegistry([]))

    completeWorkflowExecutionMock
      .mockRejectedValueOnce(new Error('success finalize failed'))
      .mockRejectedValueOnce(new Error('cost only failed'))
      .mockResolvedValueOnce({})

    await expect(session.safeComplete({ finalOutput: { ok: true } })).resolves.toBeUndefined()

    await expect(
      session.safeCompleteWithError({
        error: { message: 'late error finalize' },
      })
    ).resolves.toBeUndefined()

    expect(completeWorkflowExecutionMock).toHaveBeenCalledTimes(3)
    expect(completeWorkflowExecutionMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        executionId: 'execution-3',
        finalOutput: { error: 'late error finalize' },
      })
    )
    expect(session.hasCompleted()).toBe(true)
  })

  it('preserves successful final output during fallback completion', async () => {
    const session = new LoggingSession('workflow-1', 'execution-5', 'api', 'req-1')
    session.setResolvedSecretTraceRegistry(createSecretRegistry([]))

    completeWorkflowExecutionMock
      .mockRejectedValueOnce(new Error('success finalize failed'))
      .mockResolvedValueOnce({})

    await expect(
      session.safeComplete({ finalOutput: { ok: true, stage: 'done' } })
    ).resolves.toBeUndefined()

    expect(completeWorkflowExecutionMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        executionId: 'execution-5',
        finalOutput: { ok: true, stage: 'done' },
        finalizationPath: 'fallback_completed',
      })
    )
  })

  it('projects only TraceSpans while preserving functional completion values', async () => {
    const session = new LoggingSession('workflow-1', 'execution-safe', 'api', 'req-1')
    const secret = 'sk-demo / trace?token=7f3a91'
    const rawFinalOutput = {
      result: {
        resolvedAtRuntime: true,
        echoed: `prefix:${secret}:suffix`,
        encoded: encodeURIComponent(secret),
        ordinary: 'us-east-1',
      },
    }
    const rawTraceSpans = [
      {
        id: 'span-safe',
        name: 'Function',
        type: 'function',
        duration: 1,
        startTime: '2026-07-01T00:00:00.000Z',
        endTime: '2026-07-01T00:00:00.001Z',
        status: 'success',
        output: { echoed: secret, encoded: encodeURIComponent(secret) },
        displayResolvedSecretTraceProvenance: createDisplayProvenance([
          { plaintext: secret, replacement: '{{OPENAI_API_KEY}}' },
        ]),
      },
    ]
    const rawWorkflowInput = { prompt: `use ${secret}` }

    session.setResolvedSecretTraceRegistry(
      createSecretRegistry([{ plaintext: secret, replacement: '{{OPENAI_API_KEY}}' }])
    )
    completeWorkflowExecutionMock.mockResolvedValue({})

    await session.safeComplete({
      finalOutput: rawFinalOutput,
      traceSpans: rawTraceSpans as any,
      workflowInput: rawWorkflowInput,
    })

    expect(completeWorkflowExecutionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        finalOutput: rawFinalOutput,
        workflowInput: rawWorkflowInput,
        traceSpans: [
          expect.objectContaining({
            output: {
              echoed: '{{OPENAI_API_KEY}}',
              encoded: encodeURIComponent(secret),
            },
          }),
        ],
      })
    )
    expect(rawFinalOutput.result.echoed).toBe(`prefix:${secret}:suffix`)
    expect(rawTraceSpans[0].output.echoed).toBe(secret)
    expect(calculateCostSummary).toHaveBeenCalledWith(rawTraceSpans, undefined)

    const persistedSpans = completeWorkflowExecutionMock.mock.calls[0]?.[0].traceSpans
    expect(createOTelSpansMock).toHaveBeenCalledWith(
      expect.objectContaining({ traceSpans: persistedSpans })
    )
    expect(createOTelSpansMock.mock.calls[0]?.[0].traceSpans).toBe(persistedSpans)
  })

  it('projects secrets before display filters can truncate a long active literal', async () => {
    const session = new LoggingSession('workflow-1', 'execution-long-secret', 'api', 'req-1')
    const secret = `secret-${'x'.repeat(16_000)}`
    const sourceTraceSpans = [
      {
        id: 'span-long-secret',
        name: 'Function',
        type: 'function',
        duration: 1,
        startTime: '2026-07-01T00:00:00.000Z',
        endTime: '2026-07-01T00:00:00.001Z',
        output: { result: secret },
        displayResolvedSecretTraceProvenance: createDisplayProvenance([
          { plaintext: secret, replacement: '{{LONG_SECRET}}' },
        ]),
      },
    ]
    session.setResolvedSecretTraceRegistry(
      createSecretRegistry([{ plaintext: secret, replacement: '{{LONG_SECRET}}' }])
    )
    prepareTraceSpansForProjectionMock.mockImplementationOnce(
      async ({ traceSpans }: { traceSpans: Array<{ output?: { result?: string } }> }) => {
        expect(traceSpans[0]?.output?.result).toBe('{{LONG_SECRET}}')
        return traceSpans
      }
    )

    await session.safeComplete({ traceSpans: sourceTraceSpans as any })

    expect(completeWorkflowExecutionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        traceSpans: [expect.objectContaining({ output: { result: '{{LONG_SECRET}}' } })],
      })
    )
    expect(sourceTraceSpans[0].output.result).toBe(secret)
  })

  it('fails closed when generic log transforms reintroduce a secret literal for persistence and OTel', async () => {
    const session = new LoggingSession('workflow-1', 'execution-invariant', 'api', 'req-1')
    const sourceTraceSpans = [
      {
        id: 'span-invariant',
        name: 'Function',
        type: 'function',
        duration: 1,
        startTime: '2026-07-01T00:00:00.000Z',
        endTime: '2026-07-01T00:00:00.001Z',
        status: 'success',
        output: { apiKey: 'ordinary-value' },
        displayResolvedSecretTraceProvenance: createDisplayProvenance([
          { plaintext: 'REDACTED', replacement: '{{X}}' },
        ]),
      },
    ]
    session.setResolvedSecretTraceRegistry(
      createSecretRegistry([{ plaintext: 'REDACTED', replacement: '{{X}}' }])
    )
    prepareTraceSpansForProjectionMock.mockImplementationOnce(
      async ({ traceSpans }: { traceSpans: Array<Record<string, unknown>> }) =>
        traceSpans.map((span) => ({ ...span, output: { apiKey: '[REDACTED]' } }))
    )

    await session.safeComplete({ traceSpans: sourceTraceSpans as any })

    const persistedSpans = completeWorkflowExecutionMock.mock.calls[0]?.[0].traceSpans
    expect(persistedSpans).toEqual([
      expect.objectContaining({
        id: 'span-invariant',
        status: 'success',
      }),
    ])
    expect(persistedSpans[0]).not.toHaveProperty('output')
    expect(createOTelSpansMock).toHaveBeenCalledWith(
      expect.objectContaining({ traceSpans: persistedSpans })
    )
    expect(createOTelSpansMock.mock.calls[0]?.[0].traceSpans).toBe(persistedSpans)
    expect(sourceTraceSpans[0].output).toEqual({ apiKey: 'ordinary-value' })
  })

  it('hydrates post-transform refs before sharing structural-only spans with persistence and OTel', async () => {
    const session = new LoggingSession('workflow-1', 'execution-ref-invariant', 'api', 'req-1')
    const sourceTraceSpans = [
      {
        id: 'span-ref-invariant',
        name: 'Function',
        type: 'function',
        duration: 1,
        startTime: '2026-07-01T00:00:00.000Z',
        endTime: '2026-07-01T00:00:00.001Z',
        status: 'success',
        output: { apiKey: 'ordinary-value' },
        displayResolvedSecretTraceProvenance: createDisplayProvenance([
          { plaintext: 'EEEEEEEE', replacement: '{{X}}' },
        ]),
      },
    ]
    const ref = {
      __simLargeValueRef: true,
      version: 1,
      id: 'lv_bbbbbbbbbbbb',
      kind: 'string',
      size: 32,
      preview: '{{X}}',
    } as const
    session.setResolvedSecretTraceRegistry(
      createSecretRegistry([{ plaintext: 'EEEEEEEE', replacement: '{{X}}' }])
    )
    prepareTraceSpansForProjectionMock.mockImplementationOnce(
      async ({ traceSpans }: { traceSpans: Array<Record<string, unknown>> }) =>
        traceSpans.map((span) => ({ ...span, output: { payload: ref } }))
    )
    materializeLargeValueRefMock.mockResolvedValue({ value: 'hidden-EEEEEEEE' })

    await session.safeComplete({ traceSpans: sourceTraceSpans as any })

    const persistedSpans = completeWorkflowExecutionMock.mock.calls[0]?.[0].traceSpans
    expect(materializeLargeValueRefMock).toHaveBeenCalledWith(
      ref,
      expect.objectContaining({
        executionId: 'execution-ref-invariant',
        trackReference: false,
      })
    )
    expect(storeLargeValueMock).not.toHaveBeenCalled()
    expect(persistedSpans).toEqual([
      expect.objectContaining({
        id: 'span-ref-invariant',
        status: 'success',
      }),
    ])
    expect(persistedSpans[0]).not.toHaveProperty('output')
    expect(createOTelSpansMock.mock.calls[0]?.[0].traceSpans).toBe(persistedSpans)
    expect(sourceTraceSpans[0].output).toEqual({ apiKey: 'ordinary-value' })
  })

  it('projects synthetic error spans without copying the raw error into OTel metadata', async () => {
    const session = new LoggingSession('workflow-1', 'execution-error-safe', 'api', 'req-1')
    const secret = 'sk-demo-error-7f3a91'

    session.setResolvedSecretTraceRegistry(
      createSecretRegistry([{ plaintext: secret, replacement: '{{OPENAI_API_KEY}}' }])
    )
    completeWorkflowExecutionMock.mockResolvedValue({})
    const rawExecutionState = {
      blockStates: {
        'function-1': {
          output: { result: secret },
          resolvedSecretTraceProvenance: createDisplayProvenance([
            { plaintext: secret, replacement: '{{OPENAI_API_KEY}}' },
          ]),
        },
      },
      executedBlocks: ['function-1'],
      blockLogs: [],
      decisions: { router: {}, condition: {} },
      completedLoops: [],
      activeExecutionPath: ['function-1'],
    }

    await session.safeCompleteWithError({
      error: { message: `Function failed with ${secret}` },
      executionState: rawExecutionState,
    })

    expect(completeWorkflowExecutionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        finalOutput: { error: `Function failed with ${secret}` },
        traceSpans: [
          expect.objectContaining({
            output: { error: 'Function failed with {{OPENAI_API_KEY}}' },
          }),
        ],
        completionFailure: `Function failed with ${secret}`,
        executionState: expect.objectContaining({
          blockStates: {
            'function-1': expect.objectContaining({ output: { result: secret } }),
          },
        }),
      })
    )
    expect(createOTelSpansMock).toHaveBeenCalledWith(
      expect.not.objectContaining({ error: expect.anything() })
    )
    expect(workflowExecutedMock).toHaveBeenCalledWith(
      expect.not.objectContaining({ errorMessage: expect.anything() })
    )
  })

  it('keeps fallback functional output unchanged', async () => {
    const session = new LoggingSession('workflow-1', 'execution-fallback-safe', 'api', 'req-1')
    const secret = 'sk-demo-fallback-7f3a91'

    session.setResolvedSecretTraceRegistry(
      createSecretRegistry([{ plaintext: secret, replacement: '{{OPENAI_API_KEY}}' }])
    )
    completeWorkflowExecutionMock
      .mockRejectedValueOnce(new Error('primary persistence failed'))
      .mockResolvedValueOnce({})
    const executionState = {
      blockStates: { 'function-1': { output: { result: secret } } },
      executedBlocks: ['function-1'],
      blockLogs: [],
      decisions: { router: {}, condition: {} },
      completedLoops: [],
      activeExecutionPath: ['function-1'],
    }

    await session.safeComplete({
      finalOutput: { echoed: secret },
      executionState,
    })

    expect(completeWorkflowExecutionMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        finalOutput: { echoed: secret },
        finalizationPath: 'fallback_completed',
        executionState: expect.objectContaining({ blockStates: executionState.blockStates }),
      })
    )
  })

  it('persists structural-only spans when installed provenance is incomplete', async () => {
    const session = new LoggingSession('workflow-1', 'execution-incomplete', 'api', 'req-1')
    session.setResolvedSecretTraceRegistry(createSecretRegistry([], false))
    completeWorkflowExecutionMock.mockResolvedValue({})

    await session.safeComplete({
      finalOutput: { raw: 'functional-data' },
      traceSpans: [
        {
          id: 'span-1',
          name: 'Agent',
          type: 'agent',
          duration: 1,
          startTime: '2026-07-01T00:00:00.000Z',
          endTime: '2026-07-01T00:00:00.001Z',
          status: 'success',
          output: { raw: 'unknown-provenance' },
          displayResolvedSecretTraceProvenance: createDisplayProvenance([], false),
        },
      ],
    })

    expect(completeWorkflowExecutionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        finalOutput: { raw: 'functional-data' },
        traceSpans: [
          expect.not.objectContaining({
            output: expect.anything(),
          }),
        ],
      })
    )
  })

  it('treats legacy spans without provenance as already projected', async () => {
    const session = new LoggingSession('workflow-1', 'execution-no-registry', 'api', 'req-1')
    completeWorkflowExecutionMock.mockResolvedValue({})

    await session.safeComplete({
      traceSpans: [
        {
          id: 'span-1',
          name: 'Function',
          type: 'function',
          duration: 1,
          startTime: '2026-07-01T00:00:00.000Z',
          endTime: '2026-07-01T00:00:00.001Z',
          output: { unknown: 'provenance' },
        },
      ],
    })

    expect(completeWorkflowExecutionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        finalOutput: {},
        traceSpans: [expect.objectContaining({ output: { unknown: 'provenance' } })],
      })
    )
  })

  it('projects live block errors and terminal block logs without mutating raw callback data', async () => {
    const session = new LoggingSession('workflow-1', 'execution-display-safe', 'manual', 'req-1')
    const secret = '12345678'
    const rawError = `Reference Error: Line 1: return blah +${secret} - blah is not defined`
    const rawLog = {
      blockId: 'function-1',
      blockName: 'Function 1',
      blockType: 'function',
      startedAt: '2026-07-01T00:00:00.000Z',
      endedAt: '2026-07-01T00:00:00.001Z',
      durationMs: 1,
      success: false,
      executionOrder: 1,
      input: { code: `return blah +${secret}` },
      output: { error: rawError },
      error: rawError,
      displayResolvedSecretTraceProvenance: createDisplayProvenance([
        { plaintext: secret, replacement: '{{NUMBER_SECRET}}' },
      ]),
    }
    session.setResolvedSecretTraceRegistry(
      createSecretRegistry([{ plaintext: secret, replacement: '{{NUMBER_SECRET}}' }])
    )

    const display = await session.projectDisplayContent(
      {
        input: rawLog.input,
        output: rawLog.output,
        error: rawError,
      },
      rawLog.displayResolvedSecretTraceProvenance
    )
    const [displayLog] = await session.projectBlockLogsForDisplay([rawLog])

    expect(display).toEqual({
      input: { code: 'return blah +{{NUMBER_SECRET}}' },
      output: {
        error: 'Reference Error: Line 1: return blah +{{NUMBER_SECRET}} - blah is not defined',
      },
      error: 'Reference Error: Line 1: return blah +{{NUMBER_SECRET}} - blah is not defined',
      clearLiveDisplay: true,
    })
    expect(displayLog.input).toEqual(display.input)
    expect(displayLog.output).toEqual(display.output)
    expect(displayLog.error).toBe(display.error)
    expect(displayLog.clearLiveDisplay).toBe(true)
    expect(rawLog.input.code).toBe(`return blah +${secret}`)
    expect(rawLog.output.error).toBe(rawError)
    expect(rawLog.error).toBe(rawError)
  })

  it('projects large terminal log sets in bounded batches without dropping rows', async () => {
    const session = new LoggingSession('workflow-1', 'execution-display-batches', 'manual', 'req-1')
    session.setResolvedSecretTraceRegistry(
      createSecretRegistry([{ plaintext: 'raw-secret', replacement: '{{TOKEN}}' }])
    )
    const rawLogs = Array.from({ length: 129 }, (_, index) => ({
      blockId: `function-${index}`,
      blockName: `Function ${index}`,
      blockType: 'function',
      startedAt: '2026-07-01T00:00:00.000Z',
      endedAt: '2026-07-01T00:00:00.001Z',
      durationMs: 1,
      success: true,
      executionOrder: index,
      output: { value: `row-${index}:raw-secret` },
      displayResolvedSecretTraceProvenance: createDisplayProvenance([
        { plaintext: 'raw-secret', replacement: '{{TOKEN}}' },
      ]),
    }))

    const displayLogs = await session.projectBlockLogsForDisplay(rawLogs)

    expect(displayLogs).toHaveLength(rawLogs.length)
    expect(displayLogs[0].output).toEqual({ value: 'row-0:{{TOKEN}}' })
    expect(displayLogs[128].output).toEqual({ value: 'row-128:{{TOKEN}}' })
    expect(rawLogs[128].output.value).toBe('row-128:raw-secret')
  })

  it('projects a numeric Function result produced by a resolved numeric secret', async () => {
    const session = new LoggingSession('workflow-1', 'execution-numeric-secret', 'manual', 'req-1')
    session.setResolvedSecretTraceRegistry(
      createSecretRegistry([{ plaintext: '12345678', replacement: '{{OPENAI_API_KEY}}' }])
    )
    const rawLog = {
      blockId: 'function-1',
      blockName: 'Function 1',
      blockType: 'function',
      startedAt: '2026-07-01T00:00:00.000Z',
      endedAt: '2026-07-01T00:00:00.001Z',
      durationMs: 1,
      success: true,
      executionOrder: 1,
      input: { code: 'return 12345678' },
      output: { result: 12345678, stdout: '' },
      displayResolvedSecretTraceProvenance: createDisplayProvenance([
        { plaintext: '12345678', replacement: '{{OPENAI_API_KEY}}' },
      ]),
    }

    const [displayLog] = await session.projectBlockLogsForDisplay([rawLog])

    expect(displayLog.input).toEqual({ code: 'return {{OPENAI_API_KEY}}' })
    expect(displayLog.output).toEqual({ result: '{{OPENAI_API_KEY}}', stdout: '' })
    expect(rawLog.output.result).toBe(12345678)
  })

  it('projects each block log with only its causal provenance', async () => {
    const session = new LoggingSession('workflow-1', 'execution-sibling-values', 'manual', 'req-1')
    session.setResolvedSecretTraceRegistry(
      createSecretRegistry([{ plaintext: 'TestValue', replacement: '{{SHORT_SECRET}}' }])
    )
    const baseLog = {
      blockName: 'Function',
      blockType: 'function',
      startedAt: '2026-07-01T00:00:00.000Z',
      endedAt: '2026-07-01T00:00:00.001Z',
      durationMs: 1,
      success: true,
    }
    const displayLogs = await session.projectBlockLogsForDisplay([
      {
        ...baseLog,
        blockId: 'secret-block',
        executionOrder: 1,
        output: { result: 'TestValue' },
        displayResolvedSecretTraceProvenance: createDisplayProvenance([
          { plaintext: 'TestValue', replacement: '{{SHORT_SECRET}}' },
        ]),
      },
      {
        ...baseLog,
        blockId: 'public-block',
        executionOrder: 2,
        output: { result: 'TestValue' },
        displayResolvedSecretTraceProvenance: createDisplayProvenance([]),
      },
    ])

    expect(displayLogs[0].output).toEqual({ result: '{{SHORT_SECRET}}' })
    expect(displayLogs[1].output).toEqual({ result: 'TestValue' })
    expect(displayLogs[0]).not.toHaveProperty('displayResolvedSecretTraceProvenance')
    expect(displayLogs[1]).not.toHaveProperty('displayResolvedSecretTraceProvenance')
  })

  it('suppresses live deltas once a resolved secret is active', async () => {
    const active = new LoggingSession('workflow-1', 'execution-live-active', 'manual', 'req-1')
    active.setResolvedSecretTraceRegistry(
      createSecretRegistry([{ plaintext: 'split-secret', replacement: '{{SECRET}}' }])
    )

    const inactive = new LoggingSession('workflow-1', 'execution-live-inactive', 'manual', 'req-1')
    inactive.setResolvedSecretTraceRegistry(createSecretRegistry([]))

    await expect(
      active.projectLiveDisplayText(
        'chunk',
        'split-',
        createDisplayProvenance([{ plaintext: 'split-secret', replacement: '{{SECRET}}' }])
      )
    ).resolves.toEqual({ clearLiveDisplay: true })
    await expect(
      inactive.projectLiveDisplayText('chunk', 'ordinary text', createDisplayProvenance([]))
    ).resolves.toEqual({ chunk: 'ordinary text' })
  })

  it('derives fallback cost from trace spans when the primary completion fails', async () => {
    const session = new LoggingSession('workflow-1', 'execution-6', 'api', 'req-1') as any

    // Resume-accumulation is retired: the cost-only fallback now derives its
    // cost summary from the in-memory trace spans (billing itself reconciles
    // from the usage_log ledger in recordExecutionUsage). The primary complete()
    // path consumes one calculateCostSummary call before it fails, so queue the
    // same value twice (primary attempt + fallback).
    const spanCostSummary = {
      totalCost: 12,
      totalInputCost: 5,
      totalOutputCost: 7,
      totalTokens: 24,
      totalPromptTokens: 11,
      totalCompletionTokens: 13,
      baseExecutionCharge: 0,
      models: {},
      charges: {},
    }
    vi.mocked(calculateCostSummary)
      .mockReturnValueOnce(spanCostSummary)
      .mockReturnValueOnce(spanCostSummary)

    completeWorkflowExecutionMock
      .mockRejectedValueOnce(new Error('success finalize failed'))
      .mockResolvedValueOnce({})

    const traceSpans = [
      {
        id: 'span-1',
        name: 'Block A',
        type: 'tool',
        duration: 25,
        startTime: '2026-03-13T10:00:00.000Z',
        endTime: '2026-03-13T10:00:00.025Z',
        status: 'success',
      },
    ] as any

    await expect(
      session.safeComplete({ finalOutput: { ok: true }, traceSpans })
    ).resolves.toBeUndefined()

    expect(calculateCostSummary).toHaveBeenLastCalledWith(traceSpans, undefined)
    expect(completeWorkflowExecutionMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        executionId: 'execution-6',
        finalizationPath: 'fallback_completed',
        costSummary: expect.objectContaining({
          totalCost: 12,
          totalInputCost: 5,
          totalOutputCost: 7,
          totalTokens: 24,
        }),
      })
    )
  })

  it('persists failed error semantics when completeWithError receives non-error trace spans', async () => {
    const session = new LoggingSession('workflow-1', 'execution-4', 'api', 'req-1')
    session.setResolvedSecretTraceRegistry(createSecretRegistry([]))
    const traceSpans = [
      {
        id: 'span-1',
        name: 'Block A',
        type: 'tool',
        duration: 25,
        startTime: '2026-03-13T10:00:00.000Z',
        endTime: '2026-03-13T10:00:00.025Z',
        status: 'success',
      },
    ]

    completeWorkflowExecutionMock.mockResolvedValue({})

    await expect(
      session.safeCompleteWithError({
        error: { message: 'persist me as failed' },
        traceSpans,
      })
    ).resolves.toBeUndefined()

    expect(completeWorkflowExecutionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId: 'execution-4',
        finalOutput: { error: 'persist me as failed' },
        traceSpans,
        level: 'error',
        status: 'failed',
        finalizationPath: 'force_failed',
        completionFailure: 'persist me as failed',
      })
    )
  })

  it('marks paused completions as completed and deduplicates later attempts', async () => {
    const session = new LoggingSession('workflow-1', 'execution-1', 'api', 'req-1')

    completeWorkflowExecutionMock.mockResolvedValue({ persistedStatus: 'pending' })

    await expect(
      session.safeCompleteWithPause({
        endedAt: new Date().toISOString(),
        totalDurationMs: 10,
        traceSpans: [],
        workflowInput: { hello: 'world' },
      })
    ).resolves.toBeUndefined()

    expect(session.hasCompleted()).toBe(true)
    expect(session.getPersistedCompletionStatus()).toBe('pending')

    await expect(
      session.safeCompleteWithError({
        error: { message: 'should be ignored' },
      })
    ).resolves.toBeUndefined()

    expect(completeWorkflowExecutionMock).toHaveBeenCalledTimes(1)
  })

  it('records cancellation when pause finalization observes an already-cancelled log', async () => {
    dbChainMockFns.limit.mockResolvedValue([{ status: 'cancelled' }])
    const session = new LoggingSession('workflow-1', 'execution-1', 'api', 'req-1')

    await session.safeCompleteWithPause()

    expect(session.hasCompleted()).toBe(true)
    expect(session.getPersistedCompletionStatus()).toBe('cancelled')
    expect(completeWorkflowExecutionMock).not.toHaveBeenCalled()
  })

  it('reconciles cancellation data after an external cancel already won the status race', async () => {
    dbChainMockFns.limit.mockResolvedValue([{ status: 'cancelled' }])
    completeWorkflowExecutionMock.mockResolvedValue({ persistedStatus: 'cancelled' })
    const session = new LoggingSession('workflow-1', 'execution-1', 'api', 'req-1')
    const traceSpans = [
      {
        id: 'span-1',
        name: 'Function',
        type: 'block',
        duration: 10,
        startTime: '2026-08-03T12:00:00.000Z',
        endTime: '2026-08-03T12:00:00.010Z',
        status: 'success' as const,
      },
    ]
    const executionState = {
      blockStates: {},
      executedBlocks: [],
      blockLogs: [],
      decisions: { router: {}, condition: {} },
      completedLoops: [],
      activeExecutionPath: [],
    }

    await session.safeCompleteWithCancellation({
      totalDurationMs: 10,
      traceSpans,
      executionState,
    })

    expect(completeWorkflowExecutionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId: 'execution-1',
        executionState,
        finalOutput: { cancelled: true },
        finalizationPath: 'cancelled',
        status: 'cancelled',
        traceSpans,
      })
    )
    expect(session.getPersistedCompletionStatus()).toBe('cancelled')
    expect(releaseExecutionSlotMock).toHaveBeenCalledWith('execution-1')
  })

  it('releases success, failure, and cancellation but defers paused release', async () => {
    completeWorkflowExecutionMock.mockResolvedValue({})

    const completed = new LoggingSession('workflow-1', 'execution-complete', 'api', 'req-1')
    const failed = new LoggingSession('workflow-1', 'execution-failed', 'api', 'req-1')
    const cancelled = new LoggingSession('workflow-1', 'execution-cancelled', 'api', 'req-1')
    const paused = new LoggingSession('workflow-1', 'execution-paused', 'api', 'req-1')

    await completed.safeComplete()
    await failed.safeCompleteWithError({ error: { message: 'failed' } })
    await cancelled.safeCompleteWithCancellation()
    await paused.safeCompleteWithPause()

    expect(releaseExecutionSlotMock.mock.calls.map(([executionId]) => executionId)).toEqual([
      'execution-complete',
      'execution-failed',
      'execution-cancelled',
    ])
  })

  it('releases the attempt reservation while finalizing the parent execution log', async () => {
    completeWorkflowExecutionMock.mockResolvedValue({})
    const session = new LoggingSession(
      'workflow-1',
      'parent-execution-1',
      'manual',
      'req-1',
      'resume-entry-1'
    )

    await session.safeComplete()

    expect(completeWorkflowExecutionMock).toHaveBeenCalledWith(
      expect.objectContaining({ executionId: 'parent-execution-1' })
    )
    expect(releaseExecutionSlotMock).toHaveBeenCalledWith('resume-entry-1')
  })

  it('falls back to cost-only logging when paused completion fails', async () => {
    const session = new LoggingSession('workflow-1', 'execution-2', 'api', 'req-1')

    completeWorkflowExecutionMock
      .mockRejectedValueOnce(new Error('pause finalize failed'))
      .mockResolvedValueOnce({})
    const executionState = {
      blockStates: { 'function-1': { output: { result: 'raw-secret-value' } } },
      executedBlocks: ['function-1'],
      blockLogs: [],
      decisions: { router: {}, condition: {} },
      completedLoops: [],
      activeExecutionPath: ['function-1'],
    }

    await expect(
      session.safeCompleteWithPause({
        endedAt: new Date().toISOString(),
        totalDurationMs: 10,
        traceSpans: [],
        workflowInput: { hello: 'world' },
        executionState,
      })
    ).resolves.toBeUndefined()

    expect(session.hasCompleted()).toBe(true)
    expect(completeWorkflowExecutionMock).toHaveBeenCalledTimes(2)
    expect(completeWorkflowExecutionMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        finalizationPath: 'paused',
        executionState: expect.objectContaining({ blockStates: executionState.blockStates }),
      })
    )
  })

  it('persists last started block independently from cost accumulation', async () => {
    const session = new LoggingSession('workflow-1', 'execution-1', 'api', 'req-1')

    await session.onBlockStart('block-1', 'Fetch', 'api', '2025-01-01T00:00:00.000Z')

    expect(dbChainMockFns.select).not.toHaveBeenCalled()
    expect(dbChainMockFns.execute).toHaveBeenCalledTimes(1)
  })

  it('enforces started marker monotonicity in the database write path', async () => {
    const session = new LoggingSession('workflow-1', 'execution-1', 'api', 'req-1')

    await session.onBlockStart('block-1', 'Fetch', 'api', '2025-01-01T00:00:00.000Z')

    expect(dbMocks.sql).toHaveBeenCalled()
    expect(dbChainMockFns.execute).toHaveBeenCalledTimes(1)
  })

  it('allows same-millisecond started markers to replace the prior marker', async () => {
    const session = new LoggingSession('workflow-1', 'execution-1', 'api', 'req-1')

    await session.onBlockStart('block-1', 'Fetch', 'api', '2025-01-01T00:00:00.000Z')

    const queryCall = dbMocks.sql.mock.calls.at(-1)
    expect(queryCall).toBeDefined()

    const [query] = queryCall!
    expect(Array.from(query).join(' ')).toContain('<=')
  })

  it('persists last completed block for zero-cost outputs', async () => {
    const session = new LoggingSession('workflow-1', 'execution-1', 'api', 'req-1')

    await session.onBlockComplete('block-2', 'Transform', 'function', {
      endedAt: '2025-01-01T00:00:01.000Z',
      output: { value: true },
    })

    expect(dbChainMockFns.select).not.toHaveBeenCalled()
    expect(dbChainMockFns.execute).toHaveBeenCalledTimes(1)
  })

  it('allows same-millisecond completed markers to replace the prior marker', async () => {
    const session = new LoggingSession('workflow-1', 'execution-1', 'api', 'req-1')

    await session.onBlockComplete('block-2', 'Transform', 'function', {
      endedAt: '2025-01-01T00:00:01.000Z',
      output: { value: true },
    })

    const queryCall = dbMocks.sql.mock.calls.at(-1)
    expect(queryCall).toBeDefined()

    const [query] = queryCall!
    expect(Array.from(query).join(' ')).toContain('<=')
  })

  it('drains pending lifecycle writes before terminal completion', async () => {
    let releasePersist: (() => void) | undefined
    const persistPromise = new Promise<void>((resolve) => {
      releasePersist = resolve
    })

    const session = new LoggingSession('workflow-1', 'execution-1', 'api', 'req-1') as any
    session.persistLastStartedBlock = vi.fn(() => persistPromise)
    session.complete = vi.fn().mockResolvedValue(undefined)

    const startPromise = session.onBlockStart('block-1', 'Fetch', 'api', '2025-01-01T00:00:00.000Z')
    const completionPromise = session.safeComplete({ finalOutput: { ok: true } })

    await Promise.resolve()

    expect(session.complete).not.toHaveBeenCalled()

    releasePersist?.()

    await startPromise
    await completionPromise

    expect(session.persistLastStartedBlock).toHaveBeenCalledTimes(1)
    expect(session.complete).toHaveBeenCalledTimes(1)
  })

  it('drains fire-and-forget block-complete marker writes before terminal completion', async () => {
    let releasePersist: (() => void) | undefined
    const persistPromise = new Promise<void>((resolve) => {
      releasePersist = resolve
    })

    const session = new LoggingSession('workflow-1', 'execution-1', 'api', 'req-1') as any
    session.persistLastCompletedBlock = vi.fn(() => persistPromise)
    session.complete = vi.fn().mockResolvedValue(undefined)

    // onBlockComplete is now marker-only; its marker write is fire-and-forget
    // but tracked, so terminal completion must drain it first.
    void session.onBlockComplete('block-2', 'Transform', 'function', {
      endedAt: '2025-01-01T00:00:01.000Z',
      output: { value: true },
    })

    const completionPromise = session.safeComplete({ finalOutput: { ok: true } })

    await Promise.resolve()

    expect(session.complete).not.toHaveBeenCalled()

    releasePersist?.()

    await completionPromise

    expect(session.persistLastCompletedBlock).toHaveBeenCalledTimes(1)
    expect(session.complete).toHaveBeenCalledTimes(1)
  })

  it('keeps draining when new progress writes arrive during drain', async () => {
    let releaseFirst: (() => void) | undefined
    let releaseSecond: (() => void) | undefined
    const firstPromise = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const secondPromise = new Promise<void>((resolve) => {
      releaseSecond = resolve
    })

    const session = new LoggingSession('workflow-1', 'execution-1', 'api', 'req-1') as any

    void session.trackProgressWrite(firstPromise)

    const drainPromise = session.drainPendingProgressWrites()

    await Promise.resolve()

    void session.trackProgressWrite(secondPromise)
    releaseFirst?.()

    await Promise.resolve()

    let drained = false
    void drainPromise.then(() => {
      drained = true
    })

    await Promise.resolve()
    expect(drained).toBe(false)

    releaseSecond?.()
    await drainPromise

    expect(session.pendingProgressWrites.size).toBe(0)
  })

  it('marks pause completion as terminal and prevents duplicate pause finalization', async () => {
    const session = new LoggingSession('workflow-1', 'execution-1', 'api', 'req-1') as any
    session.completeExecutionWithFinalization = vi.fn().mockResolvedValue(undefined)

    await session.completeWithPause({ workflowInput: { ok: true } })
    await session.completeWithPause({ workflowInput: { ok: true } })

    expect(session.completeExecutionWithFinalization).toHaveBeenCalledTimes(1)
    expect(session.completed).toBe(true)
    expect(session.completing).toBe(true)
  })
})

describe('completeWithError cancelled-status guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('skips writing failed and marks session complete when DB status is already cancelled', async () => {
    dbChainMockFns.limit.mockResolvedValue([{ status: 'cancelled' }])
    const session = new LoggingSession('workflow-1', 'execution-1', 'api', 'req-1')

    await session.safeCompleteWithError({ error: { message: 'block errored mid-cancel' } })

    expect(completeWorkflowExecutionMock).not.toHaveBeenCalled()
    expect(session.hasCompleted()).toBe(true)
  })

  it('writes failed when DB status is running (no cancel in flight)', async () => {
    dbChainMockFns.limit.mockResolvedValue([{ status: 'running' }])
    completeWorkflowExecutionMock.mockResolvedValue({})
    const session = new LoggingSession('workflow-1', 'execution-1', 'api', 'req-1')

    await session.safeCompleteWithError({ error: { message: 'genuine block failure' } })

    expect(completeWorkflowExecutionMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' })
    )
    expect(session.hasCompleted()).toBe(true)
  })

  it('writes failed when no execution log exists yet', async () => {
    dbChainMockFns.limit.mockResolvedValue([])
    completeWorkflowExecutionMock.mockResolvedValue({})
    const session = new LoggingSession('workflow-1', 'execution-1', 'api', 'req-1')

    await session.safeCompleteWithError({ error: { message: 'pre-log error' } })

    expect(completeWorkflowExecutionMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' })
    )
  })

  it('deduplicates all subsequent completion attempts after guard early-return', async () => {
    dbChainMockFns.limit.mockResolvedValue([{ status: 'cancelled' }])
    completeWorkflowExecutionMock.mockResolvedValue({})
    const session = new LoggingSession('workflow-1', 'execution-1', 'api', 'req-1')

    await session.safeCompleteWithError({ error: { message: 'error 1' } })
    await session.safeCompleteWithError({ error: { message: 'error 2' } })
    await session.safeComplete({ finalOutput: { ok: true } })

    expect(completeWorkflowExecutionMock).not.toHaveBeenCalled()
    expect(session.hasCompleted()).toBe(true)
  })

  it('falls through to cost-only fallback when the DB check itself throws', async () => {
    dbChainMockFns.limit.mockRejectedValueOnce(new Error('DB connection lost'))
    completeWorkflowExecutionMock.mockResolvedValue({})
    const session = new LoggingSession('workflow-1', 'execution-1', 'api', 'req-1')
    const executionState = {
      blockStates: { 'function-1': { output: { result: 'raw-secret-value' } } },
      executedBlocks: ['function-1'],
      blockLogs: [],
      decisions: { router: {}, condition: {} },
      completedLoops: [],
      activeExecutionPath: ['function-1'],
    }

    await session.safeCompleteWithError({
      error: { message: 'block failed' },
      executionState,
    })

    expect(completeWorkflowExecutionMock).toHaveBeenCalledWith(
      expect.objectContaining({ finalizationPath: 'force_failed', executionState })
    )
    expect(session.hasCompleted()).toBe(true)
  })
})

describe('LoggingSession.markExecutionAsFailed workflowId scoping', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('scopes UPDATE by both executionId and workflowId', async () => {
    await LoggingSession.markExecutionAsFailed('exec-1', undefined, undefined, 'wf-1')

    expect(dbChainMockFns.update).toHaveBeenCalledTimes(1)
    expect(dbChainMockFns.set).toHaveBeenCalledTimes(1)
    expect(dbChainMockFns.where).toHaveBeenCalledTimes(1)

    const whereArgs = dbChainMockFns.where.mock.calls[0]
    expect(whereArgs).toBeDefined()
  })

  it('instance markAsFailed forwards workflowId to the static method', async () => {
    dbChainMockFns.limit.mockResolvedValue([{ executionData: {} }])

    const session = new LoggingSession('wf-42', 'exec-42', 'api', 'req-1')
    await session.markAsFailed('something went wrong')

    expect(dbChainMockFns.update).toHaveBeenCalledTimes(1)
    expect(releaseExecutionSlotMock).toHaveBeenCalledWith('exec-42')
  })

  it('uses the provided errorMessage in the SQL set', async () => {
    const sqlMock = dbMocks.sql
    await LoggingSession.markExecutionAsFailed('exec-2', 'custom error', undefined, 'wf-2')

    expect(sqlMock).toHaveBeenCalled()
    const combined = sqlMock.mock.calls
      .map(([strings, ...values]) => {
        return String(Array.from(strings)).toLowerCase() + values.join(' ').toLowerCase()
      })
      .join(' ')
    expect(combined).toContain('force_failed')
    expect(combined).toContain('secretprojectionversion')
  })

  it('does not overwrite a cancellation with a late force-failure', async () => {
    await LoggingSession.markExecutionAsFailed('exec-cancelled', 'late failure', undefined, 'wf-1')

    const statusGuards = dbMocks.sql.mock.calls
      .map(([strings]) => String(Array.from(strings)))
      .filter((query) => query.includes("!= 'cancelled'"))
    expect(statusGuards).toHaveLength(1)
  })

  it('terminalizes the row it force-fails: end timestamp, derived duration, deadline cleared', async () => {
    await LoggingSession.markExecutionAsFailed('exec-terminal', 'boom', undefined, 'wf-1')

    const payload = dbChainMockFns.set.mock.calls[0]?.[0] as {
      level: string
      status: string
      endedAt: Date
      totalDurationMs: { strings: TemplateStringsArray; values: unknown[] }
      executionDeadlineAt: Date | null
      executionData: unknown
    }
    expect(payload.level).toBe('error')
    expect(payload.status).toBe('failed')
    expect(payload.endedAt).toBeInstanceOf(Date)
    expect(payload.executionDeadlineAt).toBeNull()

    /**
     * The duration is the derived SQL fragment, not a number the caller carried
     * in — `elapsedDurationMsSql` measures against the row's own `started_at`
     * and preserves what a paused row already banked.
     */
    expect(String(Array.from(payload.totalDurationMs.strings))).toContain("= 'pending' THEN ")
    expect(payload.totalDurationMs.values).toContain(workflowExecutionLogs.totalDurationMs)

    /**
     * The end instant is bound through `started_at`'s encoder specifically.
     * `endedAt`'s encoder renders identically and would silently subtract the
     * timestamp from itself — a duration of zero on every force-failed run.
     */
    expect(dbMocks.sql.param).toHaveBeenCalledWith(payload.endedAt, workflowExecutionLogs.startedAt)
  })

  it('clears Redis markers when marking failed (terminal boundary outside completeWorkflowExecution)', async () => {
    await LoggingSession.markExecutionAsFailed('exec-3', 'boom', undefined, 'wf-3')
    expect(clearProgressMarkersMock).toHaveBeenCalledWith('exec-3')
  })

  it('folds live Redis markers into the row before clearing on force-fail', async () => {
    getProgressMarkersMock.mockResolvedValueOnce({
      lastStartedBlock: { blockId: 'b1', blockName: 'Fetch', blockType: 'api', startedAt: 't1' },
      lastCompletedBlock: {
        blockId: 'b1',
        blockName: 'Fetch',
        blockType: 'api',
        endedAt: 't2',
        success: false,
      },
    })

    await LoggingSession.markExecutionAsFailed('exec-9', 'boom', undefined, 'wf-9')

    const folded = dbMocks.sql.mock.calls
      .map((c) => String(Array.from(c[0] as TemplateStringsArray)))
      .join(' ')
    expect(folded).toContain('lastStartedBlock')
    expect(folded).toContain('lastCompletedBlock')
    expect(clearProgressMarkersMock).toHaveBeenCalledWith('exec-9')
  })

  it('does not clear markers when the Redis read fails (avoids wiping the only copy)', async () => {
    getProgressMarkersMock.mockResolvedValueOnce(null)
    await LoggingSession.markExecutionAsFailed('exec-readfail', 'boom', undefined, 'wf-x')
    expect(clearProgressMarkersMock).not.toHaveBeenCalled()
  })
})

describe('LoggingSession progress-marker write path', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    startWorkflowExecutionMock.mockResolvedValue({})
    loadWorkflowStateForExecutionMock.mockResolvedValue({
      blocks: {},
      edges: [],
      loops: {},
      parallels: {},
    })
    resetDbChainMock()
  })

  it('writes markers to Redis (not the row) when Redis accepts the write', async () => {
    setLastStartedBlockMock.mockResolvedValue(true)
    setLastCompletedBlockMock.mockResolvedValue(true)
    const session = new LoggingSession('wf-1', 'exec-redis', 'manual', 'req-1')
    await session.start({ workspaceId: 'ws-1' })

    await session.onBlockStart('b1', 'Fetch', 'api', '2026-06-27T10:00:00.000Z')
    await session.onBlockComplete('b1', 'Fetch', 'api', { endedAt: '2026-06-27T10:00:01.000Z' })

    expect(setLastStartedBlockMock).toHaveBeenCalledWith(
      'exec-redis',
      expect.objectContaining({ blockId: 'b1', startedAt: '2026-06-27T10:00:00.000Z' })
    )
    expect(setLastCompletedBlockMock).toHaveBeenCalledWith(
      'exec-redis',
      expect.objectContaining({ blockId: 'b1', success: true })
    )
    expect(dbChainMockFns.execute).not.toHaveBeenCalled()
  })

  it('falls back to the SQL UPDATE when the Redis write fails', async () => {
    setLastStartedBlockMock.mockResolvedValue(false)
    const session = new LoggingSession('wf-1', 'exec-redis-down', 'manual', 'req-1')
    await session.start({ workspaceId: 'ws-1' })

    await session.onBlockStart('b1', 'Fetch', 'api', '2026-06-27T10:00:00.000Z')

    expect(setLastStartedBlockMock).toHaveBeenCalled()
    expect(dbChainMockFns.execute).toHaveBeenCalledTimes(1)
  })
})

describe('secret usage trail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    dbChainMockFns.limit.mockResolvedValue([])
    completeWorkflowExecutionMock.mockResolvedValue({})
    releaseExecutionSlotMock.mockResolvedValue(undefined)
  })

  async function startSession(executionId: string) {
    const session = new LoggingSession('workflow-1', executionId, 'schedule', 'req-usage')
    session.setResolvedSecretTraceRegistry(createSecretRegistry([]))
    await session.start({
      userId: 'user-1',
      actorUserId: 'actor-1',
      workspaceId: 'workspace-1',
      skipLogCreation: true,
    })
    return session
  }

  it('records what a completed run resolved, against the run actor', async () => {
    const session = await startSession('execution-usage-complete')

    await session.complete({})

    expect(recordSecretUsageMock).toHaveBeenCalledWith(
      [{ name: 'API_KEY', scope: 'workspace' }],
      expect.objectContaining({
        workspaceId: 'workspace-1',
        source: 'workflow',
        actorUserId: 'actor-1',
        workflowId: 'workflow-1',
        executionId: 'execution-usage-complete',
        trigger: 'schedule',
      })
    )
  })

  it('records a failed run, which resolved the secret just the same', async () => {
    const session = await startSession('execution-usage-error')

    await session.completeWithError({ error: new Error('boom') })

    expect(recordSecretUsageMock).toHaveBeenCalledTimes(1)
  })

  /**
   * A paused run resumes and completes later. Recording at the pause as well would count every
   * human-in-the-loop run twice.
   */
  it('does not record a pause, which the resume will record', async () => {
    const session = await startSession('execution-usage-pause')

    await session.completeWithPause({})

    expect(recordSecretUsageMock).not.toHaveBeenCalled()
  })
})
