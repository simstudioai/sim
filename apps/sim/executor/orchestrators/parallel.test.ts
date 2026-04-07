/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DAG } from '@/executor/dag/builder'
import type { BlockStateWriter, ContextExtensions } from '@/executor/execution/types'
import { ParallelOrchestrator } from '@/executor/orchestrators/parallel'
import type { ExecutionContext } from '@/executor/types'

vi.mock('@sim/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

function createDag(): DAG {
  return {
    nodes: new Map(),
    loopConfigs: new Map(),
    parallelConfigs: new Map([
      [
        'parallel-1',
        {
          id: 'parallel-1',
          nodes: ['task-1'],
          distribution: [],
          parallelType: 'collection',
        },
      ],
    ]),
  }
}

function createState(): BlockStateWriter {
  return {
    setBlockOutput: vi.fn(),
    setBlockState: vi.fn(),
    deleteBlockState: vi.fn(),
    unmarkExecuted: vi.fn(),
  }
}

function createContext(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    workflowId: 'workflow-1',
    workspaceId: 'workspace-1',
    executionId: 'execution-1',
    userId: 'user-1',
    blockStates: new Map(),
    executedBlocks: new Set(),
    blockLogs: [],
    metadata: { duration: 0 },
    environmentVariables: {},
    decisions: {
      router: new Map(),
      condition: new Map(),
    },
    completedLoops: new Set(),
    activeExecutionPath: new Set(),
    workflow: {
      version: '1',
      blocks: [
        {
          id: 'parallel-1',
          position: { x: 0, y: 0 },
          config: { tool: '', params: {} },
          inputs: {},
          outputs: {},
          metadata: { id: 'parallel', name: 'Parallel 1' },
          enabled: true,
        },
      ],
      connections: [],
      loops: {},
      parallels: {},
    },
    ...overrides,
  }
}

describe('ParallelOrchestrator', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('awaits empty-subflow lifecycle callbacks before returning the empty scope', async () => {
    let releaseStart: (() => void) | undefined
    const onBlockStart = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseStart = resolve
        })
    )
    const onBlockComplete = vi.fn()
    const contextExtensions: ContextExtensions = {
      onBlockStart,
      onBlockComplete,
    }
    const orchestrator = new ParallelOrchestrator(
      createDag(),
      createState(),
      null,
      contextExtensions
    )
    const ctx = createContext()

    const initializePromise = orchestrator.initializeParallelScope(ctx, 'parallel-1', 1)
    await Promise.resolve()

    expect(onBlockStart).toHaveBeenCalledTimes(1)
    expect(onBlockComplete).not.toHaveBeenCalled()

    releaseStart?.()
    const scope = await initializePromise

    expect(onBlockComplete).toHaveBeenCalledTimes(1)
    expect(scope.isEmpty).toBe(true)
  })

  it('swallows helper callback failures on empty parallel paths', async () => {
    const contextExtensions: ContextExtensions = {
      onBlockStart: vi.fn().mockRejectedValue(new Error('start failed')),
      onBlockComplete: vi.fn().mockRejectedValue(new Error('complete failed')),
    }
    const orchestrator = new ParallelOrchestrator(
      createDag(),
      createState(),
      null,
      contextExtensions
    )

    await expect(
      orchestrator.initializeParallelScope(createContext(), 'parallel-1', 1)
    ).resolves.toMatchObject({
      parallelId: 'parallel-1',
      isEmpty: true,
    })
  })
})
