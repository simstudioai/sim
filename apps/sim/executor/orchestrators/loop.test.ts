import type { SessionPrincipal } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import {
  createSerializedBlock,
  createSerializedWorkflow,
} from '@sim/testing/factories/serialized-block.factory'
import { isolatedVmMock, isolatedVmMockFns } from '@sim/testing/mocks/isolated-vm.mock'
import { storageServiceMockFns } from '@sim/testing/mocks/storage-service.mock'
import { uploadsMock } from '@sim/testing/mocks/uploads.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { classifyFailure } from '@/lib/core/errors/failure-log'
import { clearLargeValueCacheForTests } from '@/lib/execution/payloads/cache'
import { BlockType, EDGE } from '@/executor/constants'
import type { DAG, DAGNode } from '@/executor/dag/builder'
import type { EdgeManager } from '@/executor/execution/edge-manager'
import { DAGExecutor } from '@/executor/execution/executor'
import type { BlockStateController } from '@/executor/execution/types'
import { LoopOrchestrator } from '@/executor/orchestrators/loop'
import type { ExecutionContext, ExecutionResult } from '@/executor/types'
import { hasExecutionResult } from '@/executor/utils/errors'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import type { SerializedLoop, SerializedWorkflow } from '@/serializer/types'

const mockUploadFile = storageServiceMockFns.mockUploadFile

const mockExecuteInIsolatedVM = isolatedVmMockFns.mockExecuteInIsolatedVM
const mockLogger =
  vi.mocked(createLogger).mock.results[
    vi.mocked(createLogger).mock.calls.findIndex(([name]) => name === 'LoopOrchestrator')
  ].value

vi.mock('@/lib/execution/isolated-vm', () => isolatedVmMock)

vi.mock('@/lib/uploads', () => uploadsMock)

const { bodyRuns } = vi.hoisted(() => ({ bodyRuns: { count: 0 } }))

vi.mock('@/executor/handlers/registry', () => ({
  createBlockHandlers: () => [
    {
      canHandle: () => true,
      execute: async (_ctx: unknown, block: { id: string }) => {
        if (block.id === 'tick') bodyRuns.count++
        return { ok: true }
      },
    },
  ],
}))

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

const PRINCIPAL: SessionPrincipal = { kind: 'session', userId: 'user-1', sessionId: 'session-1' }

const SANDBOX_AT_CAPACITY = {
  result: null,
  stdout: '',
  error: {
    message: 'Code execution is at capacity. Please try again in a moment.',
    name: 'Error',
    isSystemError: true,
  },
}

const CONDITION_SYNTAX_ERROR = {
  result: null,
  stdout: '',
  error: { message: "Unexpected token ')'", name: 'SyntaxError' },
}

function loopWorkflow(loop: Partial<Omit<SerializedLoop, 'id' | 'nodes'>>): SerializedWorkflow {
  const blocks = [
    createSerializedBlock({ id: 'start', name: 'start', type: BlockType.STARTER }),
    createSerializedBlock({ id: 'loop', name: 'loop', type: BlockType.LOOP }),
    createSerializedBlock({ id: 'tick', name: 'tick', type: BlockType.FUNCTION }),
  ]
  return {
    ...createSerializedWorkflow(blocks, [
      { source: 'start', target: 'loop' },
      { source: 'loop', target: 'tick', sourceHandle: 'loop-start-source' },
    ]),
    loops: { loop: { id: 'loop', nodes: ['tick'], iterations: 0, ...loop } },
  }
}

/** Runs the workflow and returns its result, including the one a failed run attaches to its throw. */
async function runWorkflow(workflow: SerializedWorkflow): Promise<ExecutionResult> {
  try {
    return await new DAGExecutor({
      workflow,
      contextExtensions: { workspaceId: 'ws', executionId: 'exec-1', principal: PRINCIPAL },
    }).execute('wf')
  } catch (error) {
    if (hasExecutionResult(error)) return error.executionResult
    throw error
  }
}

function loopLog(result: ExecutionResult) {
  return result.logs?.find((log) => log.blockId === 'loop')
}

describe('loop continuation when the sandbox cannot evaluate', () => {
  beforeEach(() => {
    bodyRuns.count = 0
    clearLargeValueCacheForTests()
    mockUploadFile.mockImplementation(async ({ customKey }) => ({ key: customKey }))
  })

  it.each([
    ['For', { loopType: 'for', iterations: 5 }],
    ['ForEach', { loopType: 'forEach', forEachItems: ['a', 'b', 'c', 'd', 'e'] }],
    ['count-driven Do While', { loopType: 'doWhile', iterations: 5 }],
  ] as const)(
    'runs every iteration of a %s loop while the sandbox is at capacity',
    async (_label, loop) => {
      mockExecuteInIsolatedVM.mockResolvedValue(SANDBOX_AT_CAPACITY)

      const result = await runWorkflow(loopWorkflow(loop))

      expect(result.success).toBe(true)
      expect(bodyRuns.count).toBe(5)
      expect(loopLog(result)?.output?.results).toHaveLength(5)
    }
  )

  it('runs every iteration of a For loop when the sandbox call rejects', async () => {
    mockExecuteInIsolatedVM.mockRejectedValue(new Error('REDIS_URL is required'))

    const result = await runWorkflow(loopWorkflow({ loopType: 'for', iterations: 5 }))

    expect(result.success).toBe(true)
    expect(bodyRuns.count).toBe(5)
  })

  it('fails a While loop whose condition has a syntax error instead of skipping its body', async () => {
    mockExecuteInIsolatedVM.mockResolvedValue(CONDITION_SYNTAX_ERROR)

    const result = await runWorkflow(
      loopWorkflow({ loopType: 'while', whileCondition: '<loop.index> < 3)' })
    )

    expect(result.success).toBe(false)
    expect(bodyRuns.count).toBe(0)
    expect(result.error).toContain(
      "While loop condition could not be evaluated: Unexpected token ')'"
    )
    expect(loopLog(result)).toMatchObject({
      success: false,
      error: expect.stringContaining('condition could not be evaluated'),
    })
  })

  it.each([
    [
      'answers with a system error',
      () => mockExecuteInIsolatedVM.mockResolvedValue(SANDBOX_AT_CAPACITY),
      /at capacity/,
    ],
    [
      'rejects',
      () => mockExecuteInIsolatedVM.mockRejectedValue(new Error('REDIS_URL is required')),
      /REDIS_URL is required/,
    ],
  ] as const)(
    'fails a Do While loop mid-run when the sandbox %s instead of ending it early',
    async (_label, failSandbox, message) => {
      mockExecuteInIsolatedVM.mockResolvedValueOnce({ result: true })
      mockExecuteInIsolatedVM.mockResolvedValueOnce({ result: true })
      failSandbox()

      const result = await runWorkflow(
        loopWorkflow({ loopType: 'doWhile', doWhileCondition: '<loop.index> < 10' })
      )

      expect(result.success).toBe(false)
      expect(bodyRuns.count).toBe(3)
      expect(result.error).toMatch(/^Do While loop condition could not be evaluated: /)
      expect(result.error).toMatch(message)
      expect(loopLog(result)).toMatchObject({ success: false })
    }
  )

  it('attributes a broken condition to the author and a sandbox failure to Sim', async () => {
    const { orchestrator } = createOrchestrator()
    const whileScope = () => ({
      iteration: 0,
      currentIterationOutputs: new Map(),
      allIterationOutputs: [],
      loopType: 'while',
      condition: 'x <',
    })

    mockExecuteInIsolatedVM.mockResolvedValueOnce(CONDITION_SYNTAX_ERROR)
    const userError = await orchestrator
      .evaluateInitialCondition(createContext(whileScope()), 'loop-1')
      .catch((error: unknown) => error)

    mockExecuteInIsolatedVM.mockResolvedValueOnce(SANDBOX_AT_CAPACITY)
    const systemError = await orchestrator
      .evaluateInitialCondition(createContext(whileScope()), 'loop-1')
      .catch((error: unknown) => error)

    expect(classifyFailure(userError)).toBe('user')
    expect(classifyFailure(systemError)).toBe('internal')
  })

  it('keeps a resolved secret out of the persisted condition error', async () => {
    const secret = 'resolved-condition-secret-value'
    const { orchestrator } = createOrchestrator()
    const scope = {
      iteration: 0,
      currentIterationOutputs: new Map(),
      allIterationOutputs: [],
      loopType: 'while',
      condition: '<condition.output>',
    } as Record<string, unknown>
    const ctx = createContext(scope)
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'CONDITION_SECRET', plaintext: secret, encryptedValue: 'encrypted-condition-secret' },
    ])
    registry.recordResolved('CONDITION_SECRET', secret)
    ctx.resolvedSecretTraceRegistry = registry
    mockExecuteInIsolatedVM.mockResolvedValueOnce({
      result: null,
      stdout: '',
      error: { message: `ReferenceError: ${secret} is not defined`, name: 'ReferenceError' },
    })

    const error = await orchestrator
      .evaluateInitialCondition(ctx, 'loop-1')
      .catch((thrown: unknown) => thrown)

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toMatch(/^While loop condition could not be evaluated/)
    expect(
      JSON.stringify([(error as Error).message, ctx.blockLogs, scope.validationError])
    ).not.toContain(secret)
  })
})
