/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearLargeValueCacheForTests } from '@/lib/execution/payloads/cache'
import { isLargeArrayManifest } from '@/lib/execution/payloads/large-array-manifest-metadata'
import { EDGE } from '@/executor/constants'
import { LoopOrchestrator } from '@/executor/orchestrators/loop'
import type { ExecutionContext } from '@/executor/types'

const { mockUploadFile } = vi.hoisted(() => ({
  mockUploadFile: vi.fn(),
}))

vi.mock('@/lib/uploads', () => ({
  StorageService: {
    uploadFile: mockUploadFile,
  },
}))

function createContext(scope: Record<string, unknown>): ExecutionContext {
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
    loopExecutions: new Map([['loop-1', scope as any]]),
  } as ExecutionContext
}

function createOrchestrator(loopConfigs = new Map<string, any>()) {
  const setBlockOutput = vi.fn()
  const orchestrator = new LoopOrchestrator(
    { loopConfigs, parallelConfigs: new Map(), nodes: new Map() } as any,
    { setBlockOutput, unmarkExecuted: vi.fn() } as any,
    { resolveSingleReference: vi.fn() } as any
  )
  return { orchestrator, setBlockOutput }
}

describe('LoopOrchestrator', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearLargeValueCacheForTests()
    mockUploadFile.mockImplementation(async ({ customKey }) => ({ key: customKey }))
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
    const ctx = createContext({})

    const scope = await orchestrator.initializeLoopScope(ctx, 'loop-1')

    expect(scope.maxIterations).toBeUndefined()
    expect(scope.condition).toBe('true')
  })

  it('keeps doWhile condition semantics when iterations are also configured', async () => {
    const { orchestrator } = createOrchestrator(
      new Map([
        [
          'loop-1',
          {
            loopType: 'doWhile',
            iterations: 2,
            doWhileCondition: 'true',
            nodes: ['block-1'],
          },
        ],
      ])
    )
    const ctx = createContext({})

    const scope = await orchestrator.initializeLoopScope(ctx, 'loop-1')

    expect(scope.maxIterations).toBeUndefined()
    expect(scope.condition).toBe('true')
  })

  it('compacts current iteration outputs before retaining them', async () => {
    const { orchestrator, setBlockOutput } = createOrchestrator()
    const ctx = createContext({
      iteration: 0,
      maxIterations: 1,
      loopType: 'doWhile',
      condition: 'true',
      currentIterationOutputs: new Map([
        [
          'block-1',
          {
            result: Array.from({ length: 200_000 }, (_, index) => ({
              id: index,
              summary: 'Issue summary that keeps each item small',
            })),
          },
        ],
      ]),
      allIterationOutputs: [],
    })

    await orchestrator.evaluateLoopContinuation(ctx, 'loop-1')

    const output = setBlockOutput.mock.calls[0][1]
    expect(Array.isArray(output.results[0])).toBe(true)
    expect(isLargeArrayManifest(output.results[0][0].result)).toBe(true)
    expect(output.results[0][0].result.totalCount).toBe(200_000)
  })
})
