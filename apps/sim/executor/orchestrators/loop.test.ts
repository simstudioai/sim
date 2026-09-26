import { createLogger } from '@sim/logger'
import { storageServiceMockFns } from '@sim/testing/mocks/storage-service.mock'
import { uploadsMock } from '@sim/testing/mocks/uploads.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearLargeValueCacheForTests } from '@/lib/execution/payloads/cache'
import { EDGE } from '@/executor/constants'
import type { DAG, DAGNode } from '@/executor/dag/builder'
import type { EdgeManager } from '@/executor/execution/edge-manager'
import type { BlockStateController } from '@/executor/execution/types'
import { LoopOrchestrator } from '@/executor/orchestrators/loop'
import type { ExecutionContext } from '@/executor/types'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const mockUploadFile = storageServiceMockFns.mockUploadFile

const { mockExecuteInIsolatedVM } = vi.hoisted(() => ({
  mockExecuteInIsolatedVM: vi.fn(),
}))
const mockLogger =
  vi.mocked(createLogger).mock.results[
    vi.mocked(createLogger).mock.calls.findIndex(([name]) => name === 'LoopOrchestrator')
  ].value

vi.mock('@/lib/execution/isolated-vm', () => ({
  executeInIsolatedVM: mockExecuteInIsolatedVM,
}))

vi.mock('@/lib/uploads', () => uploadsMock)

function createNode(id: string): DAGNode {
  return {
    id,
    block: {
      id,
      position: { x: 0, y: 0 },
      enabled: true,
      metadata: { id: 'function', name: id },
      config: { params: {} },
      inputs: {},
      outputs: {},
    },
    incomingEdges: new Set(),
    outgoingEdges: new Map(),
    metadata: {},
  }
}

function createState(): BlockStateController {
  return {
    getBlockState: vi.fn(),
    getBlockOutput: vi.fn(),
    hasExecuted: vi.fn(() => false),
    setBlockOutput: vi.fn(),
    setBlockState: vi.fn(),
    deleteBlockState: vi.fn(),
    unmarkExecuted: vi.fn(),
  }
}

function createContext(scope: Record<string, unknown> = {}, loopId = 'loop-1'): ExecutionContext {
  return {
    workflowId: 'workflow-1',
    workspaceId: 'workspace-1',
    executionId: 'execution-1',
    userId: 'user-1',
    blockStates: new Map(),
    executedBlocks: new Set(),
    blockLogs: [],
    metadata: { requestId: 'request-1' },
    environmentVariables: {},
    workflowVariables: {},
    decisions: { router: new Map(), condition: new Map() },
    completedLoops: new Set(),
    activeExecutionPath: new Set(),
    loopExecutions: new Map([[loopId, scope as any]]),
  } as ExecutionContext
}

function createOrchestrator(loopConfigs = new Map<string, any>()) {
  const state = createState()
  const orchestrator = new LoopOrchestrator(
    { loopConfigs, parallelConfigs: new Map(), nodes: new Map() } as any,
    state,
    { resolveSingleReference: vi.fn() } as any
  )
  return { orchestrator, setBlockOutput: vi.mocked(state.setBlockOutput) }
}

describe('LoopOrchestrator', () => {
  beforeEach(() => {
    clearLargeValueCacheForTests()
    mockExecuteInIsolatedVM.mockResolvedValue({ result: true })
    mockUploadFile.mockImplementation(async ({ customKey }) => ({ key: customKey }))
  })

  it('does not restore parallel_continue back edges for nested parallels', () => {
    const loopId = 'loop-1'
    const parallelId = 'parallel-1'
    const loopStartId = `loop-${loopId}-sentinel-start`
    const loopEndId = `loop-${loopId}-sentinel-end`
    const parallelStartId = `parallel-${parallelId}-sentinel-start`
    const parallelEndId = `parallel-${parallelId}-sentinel-end`
    const loopStart = createNode(loopStartId)
    const loopEnd = createNode(loopEndId)
    const parallelStart = createNode(parallelStartId)
    const parallelEnd = createNode(parallelEndId)
    loopStart.outgoingEdges.set(`${loopStartId}->${parallelStartId}`, { target: parallelStartId })
    loopStart.outgoingEdges.set(`${loopStartId}->${loopEndId}-exit`, {
      target: loopEndId,
      sourceHandle: EDGE.LOOP_EXIT,
    })
    parallelStart.outgoingEdges.set(`${parallelStartId}->${parallelEndId}-exit`, {
      target: parallelEndId,
      sourceHandle: EDGE.PARALLEL_EXIT,
    })
    parallelEnd.outgoingEdges.set(`${parallelEndId}->${parallelStartId}-continue`, {
      target: parallelStartId,
      sourceHandle: EDGE.PARALLEL_CONTINUE,
    })
    parallelEnd.outgoingEdges.set(`${parallelEndId}->${loopEndId}-exit`, {
      target: loopEndId,
      sourceHandle: EDGE.PARALLEL_EXIT,
    })

    const dag: DAG = {
      nodes: new Map([
        [loopStartId, loopStart],
        [loopEndId, loopEnd],
        [parallelStartId, parallelStart],
        [parallelEndId, parallelEnd],
      ]),
      loopConfigs: new Map([[loopId, { id: loopId, nodes: [parallelId], loopType: 'for' }]]),
      parallelConfigs: new Map([
        [parallelId, { id: parallelId, nodes: [], parallelType: 'count' }],
      ]),
    }
    const edgeManager = {
      clearDeactivatedEdgesForNodes: vi.fn(),
    } as unknown as EdgeManager
    const orchestrator = new LoopOrchestrator(dag, createState(), null as any, {}, edgeManager)

    orchestrator.restoreLoopEdges(loopId)

    expect(parallelStart.incomingEdges.has(loopStartId)).toBe(true)
    expect(parallelStart.incomingEdges.has(parallelEndId)).toBe(false)
    expect(loopEnd.incomingEdges.has(loopStartId)).toBe(false)
    expect(parallelEnd.incomingEdges.has(parallelStartId)).toBe(false)
    expect(loopEnd.incomingEdges.has(parallelEndId)).toBe(true)
  })

  it('resolves forEach collections with the loop start sentinel scope independently of the count', async () => {
    const loopId = 'loop-1'
    const dag: DAG = {
      nodes: new Map(),
      loopConfigs: new Map([
        [
          loopId,
          {
            id: loopId,
            nodes: ['task-1'],
            loopType: 'forEach',
            iterations: 1,
            forEachItems: '<Producer.items>',
          },
        ],
      ]),
      parallelConfigs: new Map(),
    }
    const resolver = {
      resolveSingleReference: vi.fn().mockResolvedValue(['item-1', 'item-2', 'item-3']),
    }
    const orchestrator = new LoopOrchestrator(dag, createState(), resolver as any, {}, {
      clearDeactivatedEdgesForNodes: vi.fn(),
    } as unknown as EdgeManager)
    const ctx = createContext()

    const scope = await orchestrator.initializeLoopScope(ctx, loopId)

    expect(resolver.resolveSingleReference).toHaveBeenCalledWith(
      expect.any(Object),
      'loop-loop-1-sentinel-start',
      '<Producer.items>',
      undefined,
      { allowLargeValueRefs: true }
    )
    expect(scope.maxIterations).toBe(3)
    expect(scope.items).toEqual(['item-1', 'item-2', 'item-3'])
  })

  it('marks empty forEach loops as skipped at the initial condition check', async () => {
    const { orchestrator, setBlockOutput } = createOrchestrator()
    const scope = {
      iteration: 0,
      currentIterationOutputs: new Map(),
      allIterationOutputs: [],
      loopType: 'forEach',
      items: [],
      maxIterations: 0,
      condition: '<loop.index> < 0',
    } as { skippedAtStart?: boolean } & Record<string, unknown>
    const ctx = createContext(scope)

    const shouldExecute = await orchestrator.evaluateInitialCondition(ctx, 'loop-1')

    expect(shouldExecute).toBe(false)
    expect(scope.skippedAtStart).toBe(true)
    expect(setBlockOutput).not.toHaveBeenCalled()

    const result = await orchestrator.evaluateLoopContinuation(ctx, 'loop-1')

    expect(result).toMatchObject({
      shouldContinue: false,
      shouldExit: true,
      selectedRoute: EDGE.LOOP_EXIT,
      aggregatedResults: [],
    })
    expect(scope.skippedAtStart).toBe(false)
    expect(setBlockOutput).toHaveBeenCalledWith('loop-1', { results: [] }, 0)
  })

  it('marks while loops with false initial conditions as skipped at start', async () => {
    const state = createState()
    const resolver = { resolveSingleReference: vi.fn().mockResolvedValue(false) }
    mockExecuteInIsolatedVM.mockResolvedValueOnce({ result: false })
    const orchestrator = new LoopOrchestrator(
      { loopConfigs: new Map(), parallelConfigs: new Map(), nodes: new Map() },
      state,
      resolver as any
    )
    const scope = {
      iteration: 0,
      currentIterationOutputs: new Map(),
      allIterationOutputs: [],
      loopType: 'while',
      condition: '<condition.output>',
    } as { skippedAtStart?: boolean } & Record<string, unknown>
    const ctx = createContext(scope)

    const shouldExecute = await orchestrator.evaluateInitialCondition(ctx, 'loop-1')

    expect(shouldExecute).toBe(false)
    expect(scope.skippedAtStart).toBe(true)
    expect(state.setBlockOutput).not.toHaveBeenCalled()
    expect(mockExecuteInIsolatedVM).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'return Boolean(false)',
      })
    )
  })

  it('escapes resolved strings without exposing rendered while conditions to logs', async () => {
    const resolvedSecret = 'quote" slash\\ newline\nresolved-condition-secret'
    const state = createState()
    const resolver = { resolveSingleReference: vi.fn().mockResolvedValue(resolvedSecret) }
    const orchestrator = new LoopOrchestrator(
      { loopConfigs: new Map(), parallelConfigs: new Map(), nodes: new Map() },
      state,
      resolver as any
    )
    const scope = {
      iteration: 0,
      currentIterationOutputs: new Map(),
      allIterationOutputs: [],
      loopType: 'while',
      condition: '<condition.output>',
    } as Record<string, unknown>
    const ctx = createContext(scope)
    const registry = new ResolvedSecretTraceRegistry([
      {
        name: 'CONDITION_SECRET',
        plaintext: resolvedSecret,
        encryptedValue: 'encrypted-condition-secret',
      },
    ])
    registry.recordResolved('CONDITION_SECRET', resolvedSecret)
    ctx.resolvedSecretTraceRegistry = registry

    await orchestrator.evaluateInitialCondition(ctx, 'loop-1')

    expect(mockExecuteInIsolatedVM).toHaveBeenCalledWith(
      expect.objectContaining({
        code: `return Boolean(${JSON.stringify(resolvedSecret)})`,
      })
    )
    const logged = JSON.stringify([
      ...mockLogger.debug.mock.calls,
      ...mockLogger.info.mock.calls,
      ...mockLogger.warn.mock.calls,
      ...mockLogger.error.mock.calls,
    ])
    expect(logged).not.toContain(resolvedSecret)
    expect(logged).not.toContain('evaluatedCondition')
    expect(logged).not.toContain('originalCondition')
  })

  it('exits doWhile loops when the configured iteration cap is reached', async () => {
    const { orchestrator } = createOrchestrator()
    const ctx = createContext({
      iteration: 4,
      maxIterations: 5,
      loopType: 'doWhile',
      condition: 'true',
      currentIterationOutputs: new Map([['block-1', { result: 'done' }]]),
      allIterationOutputs: [],
    })

    const result = await orchestrator.evaluateLoopContinuation(ctx, 'loop-1')

    expect(result).toMatchObject({
      shouldContinue: false,
      shouldExit: true,
      selectedRoute: EDGE.LOOP_EXIT,
      totalIterations: 1,
    })
  })

  it('does not treat doWhile iterations of zero as an immediate configured cap', async () => {
    const { orchestrator } = createOrchestrator(
      new Map([
        [
          'loop-1',
          {
            loopType: 'doWhile',
            iterations: 0,
            doWhileCondition: 'true',
            nodes: ['block-1'],
          },
        ],
      ])
    )
    const ctx = createContext()

    const scope = await orchestrator.initializeLoopScope(ctx, 'loop-1')

    expect(scope.maxIterations).toBeUndefined()
    expect(scope.condition).toBe('true')
  })
})
