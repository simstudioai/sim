import { vi } from 'vitest'
import type { SerializedWorkflow } from '@/serializer/types'

/**
 * Mock handler factory - creates consistent handler mocks
 */
export const createMockHandler = (
  handlerName: string,
  options?: {
    canHandleCondition?: (block: any) => boolean
    executeResult?: any
  }
) => {
  const defaultCanHandle = (block: any) =>
    block.metadata?.id === handlerName || handlerName === 'generic'

  const defaultExecuteResult = {
    result: `${handlerName} executed`,
  }

  return vi.fn().mockImplementation(() => ({
    canHandle: options?.canHandleCondition || defaultCanHandle,
    execute: vi.fn().mockResolvedValue(options?.executeResult || defaultExecuteResult),
  }))
}

/**
 * Setup all handler mocks with default behaviors
 */
export const setupHandlerMocks = () => {
  vi.doMock('../handlers', () => ({
    AgentBlockHandler: createMockHandler('agent'),
    RouterBlockHandler: createMockHandler('router'),
    ConditionBlockHandler: createMockHandler('condition'),
    EvaluatorBlockHandler: createMockHandler('evaluator'),
    FunctionBlockHandler: createMockHandler('function'),
    ApiBlockHandler: createMockHandler('api'),
    LoopBlockHandler: createMockHandler('loop'),
    ParallelBlockHandler: createMockHandler('parallel'),
    WorkflowBlockHandler: createMockHandler('workflow'),
    GenericBlockHandler: createMockHandler('generic'),
    ResponseBlockHandler: createMockHandler('response'),
  }))
}

/**
 * Setup store mocks with configurable options
 */
export const setupStoreMocks = (options?: {
  isDebugModeEnabled?: boolean
  consoleAddFn?: ReturnType<typeof vi.fn>
  consoleUpdateFn?: ReturnType<typeof vi.fn>
}) => {
  const consoleAddFn = options?.consoleAddFn || vi.fn()
  const consoleUpdateFn = options?.consoleUpdateFn || vi.fn()

  vi.doMock('@/stores/settings/general/store', () => ({
    useGeneralStore: {
      getState: () => ({
        isDebugModeEnabled: options?.isDebugModeEnabled ?? false,
      }),
    },
  }))

  vi.doMock('@/stores/execution/store', () => ({
    useExecutionStore: {
      getState: () => ({
        setIsExecuting: vi.fn(),
        reset: vi.fn(),
        setActiveBlocks: vi.fn(),
        setPendingBlocks: vi.fn(),
        setIsDebugging: vi.fn(),
      }),
      setState: vi.fn(),
    },
  }))

  vi.doMock('@/stores/console/store', () => ({
    useConsoleStore: {
      getState: () => ({
        addConsole: consoleAddFn,
      }),
    },
  }))

  vi.doMock('@/stores/panel/console/store', () => ({
    useConsoleStore: {
      getState: () => ({
        addConsole: consoleAddFn,
        updateConsole: consoleUpdateFn,
      }),
    },
  }))

  return { consoleAddFn, consoleUpdateFn }
}

/**
 * Setup core executor mocks (PathTracker, InputResolver, LoopManager, ParallelManager)
 */
export const setupExecutorCoreMocks = () => {
  vi.doMock('../path', () => ({
    PathTracker: vi.fn().mockImplementation(() => ({
      updateExecutionPaths: vi.fn(),
      isInActivePath: vi.fn().mockReturnValue(true),
    })),
  }))

  vi.doMock('../resolver', () => ({
    InputResolver: vi.fn().mockImplementation(() => ({
      resolveInputs: vi.fn().mockReturnValue({}),
      resolveBlockReferences: vi.fn().mockImplementation((value) => value),
      resolveVariableReferences: vi.fn().mockImplementation((value) => value),
      resolveEnvVariables: vi.fn().mockImplementation((value) => value),
    })),
  }))

  vi.doMock('../loops', () => ({
    LoopManager: vi.fn().mockImplementation(() => ({
      processLoopIterations: vi.fn().mockResolvedValue(false),
      getLoopIndex: vi.fn().mockImplementation((loopId, blockId, context) => {
        return context.loopIterations?.get(loopId) || 0
      }),
    })),
  }))

  vi.doMock('../parallels', () => ({
    ParallelManager: vi.fn().mockImplementation(() => ({
      processParallelIterations: vi.fn().mockResolvedValue(false),
      createVirtualBlockInstances: vi.fn().mockReturnValue([]),
      setupIterationContext: vi.fn(),
      storeIterationResult: vi.fn(),
      initializeParallel: vi.fn(),
      getIterationItem: vi.fn(),
      areAllVirtualBlocksExecuted: vi.fn().mockReturnValue(false),
    })),
  }))
}

/**
 * Workflow factory functions
 */
export const createMinimalWorkflow = (): SerializedWorkflow => ({
  version: '1.0',
  blocks: [
    {
      id: 'starter',
      position: { x: 0, y: 0 },
      config: { tool: 'test-tool', params: {} },
      inputs: {},
      outputs: {},
      enabled: true,
      metadata: { id: 'starter', name: 'Starter Block' },
    },
    {
      id: 'block1',
      position: { x: 100, y: 0 },
      config: { tool: 'test-tool', params: {} },
      inputs: {},
      outputs: {},
      enabled: true,
      metadata: { id: 'test', name: 'Test Block' },
    },
  ],
  connections: [
    {
      source: 'starter',
      target: 'block1',
    },
  ],
  loops: {},
})

export const createWorkflowWithCondition = (): SerializedWorkflow => ({
  version: '1.0',
  blocks: [
    {
      id: 'starter',
      position: { x: 0, y: 0 },
      config: { tool: 'test-tool', params: {} },
      inputs: {},
      outputs: {},
      enabled: true,
      metadata: { id: 'starter', name: 'Starter Block' },
    },
    {
      id: 'condition1',
      position: { x: 100, y: 0 },
      config: { tool: 'test-tool', params: {} },
      inputs: {},
      outputs: {},
      enabled: true,
      metadata: { id: 'condition', name: 'Condition Block' },
    },
    {
      id: 'block1',
      position: { x: 200, y: -50 },
      config: { tool: 'test-tool', params: {} },
      inputs: {},
      outputs: {},
      enabled: true,
      metadata: { id: 'test', name: 'True Path Block' },
    },
    {
      id: 'block2',
      position: { x: 200, y: 50 },
      config: { tool: 'test-tool', params: {} },
      inputs: {},
      outputs: {},
      enabled: true,
      metadata: { id: 'test', name: 'False Path Block' },
    },
  ],
  connections: [
    {
      source: 'starter',
      target: 'condition1',
    },
    {
      source: 'condition1',
      target: 'block1',
      sourceHandle: 'condition-true',
    },
    {
      source: 'condition1',
      target: 'block2',
      sourceHandle: 'condition-false',
    },
  ],
  loops: {},
})

export const createWorkflowWithLoop = (): SerializedWorkflow => ({
  version: '1.0',
  blocks: [
    {
      id: 'starter',
      position: { x: 0, y: 0 },
      config: { tool: 'test-tool', params: {} },
      inputs: {},
      outputs: {},
      enabled: true,
      metadata: { id: 'starter', name: 'Starter Block' },
    },
    {
      id: 'block1',
      position: { x: 100, y: 0 },
      config: { tool: 'test-tool', params: {} },
      inputs: {},
      outputs: {},
      enabled: true,
      metadata: { id: 'test', name: 'Loop Block 1' },
    },
    {
      id: 'block2',
      position: { x: 200, y: 0 },
      config: { tool: 'test-tool', params: {} },
      inputs: {},
      outputs: {},
      enabled: true,
      metadata: { id: 'test', name: 'Loop Block 2' },
    },
  ],
  connections: [
    {
      source: 'starter',
      target: 'block1',
    },
    {
      source: 'block1',
      target: 'block2',
    },
    {
      source: 'block2',
      target: 'block1',
    },
  ],
  loops: {
    loop1: {
      id: 'loop1',
      nodes: ['block1', 'block2'],
      iterations: 5,
      loopType: 'forEach',
      forEachItems: [1, 2, 3, 4, 5],
    },
  },
})

export const createWorkflowWithErrorPath = (): SerializedWorkflow => ({
  version: '1.0',
  blocks: [
    {
      id: 'starter',
      position: { x: 0, y: 0 },
      config: { tool: 'test-tool', params: {} },
      inputs: {},
      outputs: {},
      enabled: true,
      metadata: { id: 'starter', name: 'Starter Block' },
    },
    {
      id: 'block1',
      position: { x: 100, y: 0 },
      config: { tool: 'test-tool', params: {} },
      inputs: {},
      outputs: {},
      enabled: true,
      metadata: { id: 'function', name: 'Function Block' },
    },
    {
      id: 'error-handler',
      position: { x: 200, y: 50 },
      config: { tool: 'test-tool', params: {} },
      inputs: {},
      outputs: {},
      enabled: true,
      metadata: { id: 'test', name: 'Error Handler Block' },
    },
    {
      id: 'success-block',
      position: { x: 200, y: -50 },
      config: { tool: 'test-tool', params: {} },
      inputs: {},
      outputs: {},
      enabled: true,
      metadata: { id: 'test', name: 'Success Block' },
    },
  ],
  connections: [
    {
      source: 'starter',
      target: 'block1',
    },
    {
      source: 'block1',
      target: 'success-block',
      sourceHandle: 'source',
    },
    {
      source: 'block1',
      target: 'error-handler',
      sourceHandle: 'error',
    },
  ],
  loops: {},
})

export const createWorkflowWithParallel = (distribution?: any): SerializedWorkflow => ({
  version: '2.0',
  blocks: [
    {
      id: 'starter',
      position: { x: 0, y: 0 },
      metadata: { id: 'starter', name: 'Start' },
      config: { tool: 'starter', params: {} },
      inputs: {},
      outputs: {},
      enabled: true,
    },
    {
      id: 'parallel-1',
      position: { x: 100, y: 0 },
      metadata: { id: 'parallel', name: 'Test Parallel' },
      config: { tool: 'parallel', params: {} },
      inputs: {},
      outputs: {},
      enabled: true,
    },
    {
      id: 'function-1',
      position: { x: 200, y: 0 },
      metadata: { id: 'function', name: 'Process Item' },
      config: {
        tool: 'function',
        params: {
          code: 'return { item: <parallel.currentItem>, index: <parallel.index> }',
        },
      },
      inputs: {},
      outputs: {},
      enabled: true,
    },
    {
      id: 'endpoint',
      position: { x: 300, y: 0 },
      metadata: { id: 'generic', name: 'End' },
      config: { tool: 'generic', params: {} },
      inputs: {},
      outputs: {},
      enabled: true,
    },
  ],
  connections: [
    { source: 'starter', target: 'parallel-1' },
    { source: 'parallel-1', target: 'function-1', sourceHandle: 'parallel-start-source' },
    { source: 'parallel-1', target: 'endpoint', sourceHandle: 'parallel-end-source' },
  ],
  loops: {},
  parallels: {
    'parallel-1': {
      id: 'parallel-1',
      nodes: ['function-1'],
      distribution: distribution || ['apple', 'banana', 'cherry'],
    },
  },
})

export const createWorkflowWithResponse = (): SerializedWorkflow => ({
  version: '1.0',
  blocks: [
    {
      id: 'starter',
      position: { x: 0, y: 0 },
      config: { tool: 'test-tool', params: {} },
      inputs: {
        input: 'json',
      },
      outputs: {
        response: {
          input: 'json',
        },
      },
      enabled: true,
      metadata: { id: 'starter', name: 'Starter Block' },
    },
    {
      id: 'response',
      position: { x: 100, y: 0 },
      config: { tool: 'test-tool', params: {} },
      inputs: {
        data: 'json',
        status: 'number',
        headers: 'json',
      },
      outputs: {
        response: {
          data: 'json',
          status: 'number',
          headers: 'json',
        },
      },
      enabled: true,
      metadata: { id: 'response', name: 'Response Block' },
    },
  ],
  connections: [{ source: 'starter', target: 'response' }],
  loops: {},
})

/**
 * Create a mock execution context with customizable options
 */
export interface MockContextOptions {
  workflowId?: string
  loopIterations?: Map<string, number>
  loopItems?: Map<string, any>
  executedBlocks?: Set<string>
  activeExecutionPath?: Set<string>
  completedLoops?: Set<string>
  parallelExecutions?: Map<string, any>
  parallelBlockMapping?: Map<string, any>
  currentVirtualBlockId?: string
  workflow?: SerializedWorkflow
  blockStates?: Map<string, any>
}

export const createMockContext = (options: MockContextOptions = {}) => {
  const workflow = options.workflow || createMinimalWorkflow()

  return {
    workflowId: options.workflowId || 'test-workflow-id',
    blockStates: options.blockStates || new Map(),
    blockLogs: [],
    metadata: { startTime: new Date().toISOString(), duration: 0 },
    environmentVariables: {},
    decisions: { router: new Map(), condition: new Map() },
    loopIterations: options.loopIterations || new Map(),
    loopItems: options.loopItems || new Map(),
    executedBlocks: options.executedBlocks || new Set<string>(),
    activeExecutionPath: options.activeExecutionPath || new Set<string>(),
    workflow,
    completedLoops: options.completedLoops || new Set<string>(),
    parallelExecutions: options.parallelExecutions,
    parallelBlockMapping: options.parallelBlockMapping,
    currentVirtualBlockId: options.currentVirtualBlockId,
  }
}

/**
 * Mock implementations for testing loops
 */
export const createLoopManagerMock = (options?: {
  processLoopIterationsImpl?: (context: any) => Promise<boolean>
  getLoopIndexImpl?: (loopId: string, blockId: string, context: any) => number
}) => ({
  LoopManager: vi.fn().mockImplementation(() => ({
    processLoopIterations: options?.processLoopIterationsImpl || vi.fn().mockResolvedValue(false),
    getLoopIndex:
      options?.getLoopIndexImpl ||
      vi.fn().mockImplementation((loopId, blockId, context) => {
        return context.loopIterations.get(loopId) || 0
      }),
  })),
})

/**
 * Create a parallel execution state object for testing
 */
export const createParallelExecutionState = (options?: {
  parallelCount?: number
  distributionItems?: any[] | Record<string, any> | null
  completedExecutions?: number
  executionResults?: Map<string, any>
  activeIterations?: Set<number>
  currentIteration?: number
  parallelType?: 'count' | 'collection'
}) => ({
  parallelCount: options?.parallelCount ?? 3,
  distributionItems:
    options?.distributionItems !== undefined ? options.distributionItems : ['a', 'b', 'c'],
  completedExecutions: options?.completedExecutions ?? 0,
  executionResults: options?.executionResults ?? new Map<string, any>(),
  activeIterations: options?.activeIterations ?? new Set<number>(),
  currentIteration: options?.currentIteration ?? 1,
  parallelType: options?.parallelType,
})

/**
 * Mock implementations for testing parallels
 */
export const createParallelManagerMock = (options?: {
  maxChecks?: number
  processParallelIterationsImpl?: (context: any) => Promise<void>
}) => ({
  ParallelManager: vi.fn().mockImplementation(() => {
    const executionCounts = new Map()
    const maxChecks = options?.maxChecks || 2

    return {
      processParallelIterations:
        options?.processParallelIterationsImpl ||
        vi.fn().mockImplementation(async (context) => {
          for (const [parallelId, parallel] of Object.entries(context.workflow?.parallels || {})) {
            if (context.completedLoops.has(parallelId)) {
              continue
            }

            const parallelState = context.parallelExecutions?.get(parallelId)
            if (!parallelState || parallelState.currentIteration === 0) {
              continue
            }

            const checkCount = executionCounts.get(parallelId) || 0
            executionCounts.set(parallelId, checkCount + 1)

            if (checkCount >= maxChecks) {
              context.completedLoops.add(parallelId)
              continue
            }

            let allVirtualBlocksExecuted = true
            const parallelNodes = (parallel as any).nodes || []
            for (const nodeId of parallelNodes) {
              for (let i = 0; i < parallelState.parallelCount; i++) {
                const virtualBlockId = `${nodeId}_parallel_${parallelId}_iteration_${i}`
                if (!context.executedBlocks.has(virtualBlockId)) {
                  allVirtualBlocksExecuted = false
                  break
                }
              }
              if (!allVirtualBlocksExecuted) break
            }

            if (allVirtualBlocksExecuted && !context.completedLoops.has(parallelId)) {
              context.executedBlocks.delete(parallelId)
              context.activeExecutionPath.add(parallelId)

              for (const nodeId of parallelNodes) {
                context.activeExecutionPath.delete(nodeId)
              }
            }
          }
        }),
      createVirtualBlockInstances: vi.fn().mockImplementation((block, parallelId, state) => {
        const instances = []
        for (let i = 0; i < state.parallelCount; i++) {
          instances.push(`${block.id}_parallel_${parallelId}_iteration_${i}`)
        }
        return instances
      }),
      setupIterationContext: vi.fn(),
      storeIterationResult: vi.fn(),
      initializeParallel: vi.fn(),
      getIterationItem: vi.fn(),
      areAllVirtualBlocksExecuted: vi
        .fn()
        .mockImplementation((parallelId, parallel, executedBlocks, state) => {
          for (const nodeId of parallel.nodes) {
            for (let i = 0; i < state.parallelCount; i++) {
              const virtualBlockId = `${nodeId}_parallel_${parallelId}_iteration_${i}`
              if (!executedBlocks.has(virtualBlockId)) {
                return false
              }
            }
          }
          return true
        }),
    }
  }),
})

/**
 * Setup function block handler that executes code
 */
export const createFunctionBlockHandler = vi.fn().mockImplementation(() => ({
  canHandle: (block: any) => block.metadata?.id === 'function',
  execute: vi.fn().mockImplementation(async (block, inputs) => {
    return {
      result: inputs.code ? new Function(inputs.code)() : { key: inputs.key, value: inputs.value },
      stdout: '',
    }
  }),
}))

/**
 * Create a custom parallel block handler for testing
 */
export const createParallelBlockHandler = vi.fn().mockImplementation(() => {
  return {
    canHandle: (block: any) => block.metadata?.id === 'parallel',
    execute: vi.fn().mockImplementation(async (block, inputs, context) => {
      const parallelId = block.id
      const parallel = context.workflow?.parallels?.[parallelId]

      if (!parallel) {
        throw new Error('Parallel configuration not found')
      }

      if (!context.parallelExecutions) {
        context.parallelExecutions = new Map()
      }

      let parallelState = context.parallelExecutions.get(parallelId)

      if (!parallelState) {
        // First execution - initialize
        const distributionItems = parallel.distribution || []
        const parallelCount = Array.isArray(distributionItems)
          ? distributionItems.length
          : typeof distributionItems === 'object'
            ? Object.keys(distributionItems).length
            : 1

        parallelState = {
          parallelCount,
          distributionItems,
          completedExecutions: 0,
          executionResults: new Map(),
          activeIterations: new Set(),
          currentIteration: 1,
        }
        context.parallelExecutions.set(parallelId, parallelState)

        if (distributionItems) {
          context.loopItems.set(`${parallelId}_items`, distributionItems)
        }

        // Activate child nodes
        const connections =
          context.workflow?.connections.filter(
            (conn: any) =>
              conn.source === parallelId && conn.sourceHandle === 'parallel-start-source'
          ) || []

        for (const conn of connections) {
          context.activeExecutionPath.add(conn.target)
        }

        return {
          parallelId,
          parallelCount,
          distributionType: 'distributed',
          started: true,
          message: `Initialized ${parallelCount} parallel executions`,
        }
      }

      // Check completion
      const allCompleted = parallel.nodes.every((nodeId: string) => {
        for (let i = 0; i < parallelState.parallelCount; i++) {
          const virtualBlockId = `${nodeId}_parallel_${parallelId}_iteration_${i}`
          if (!context.executedBlocks.has(virtualBlockId)) {
            return false
          }
        }
        return true
      })

      if (allCompleted) {
        context.completedLoops.add(parallelId)

        // Activate end connections
        const endConnections =
          context.workflow?.connections.filter(
            (conn: any) => conn.source === parallelId && conn.sourceHandle === 'parallel-end-source'
          ) || []

        for (const conn of endConnections) {
          context.activeExecutionPath.add(conn.target)
        }

        return {
          parallelId,
          parallelCount: parallelState.parallelCount,
          completed: true,
          message: `Completed all ${parallelState.parallelCount} executions`,
        }
      }

      return {
        parallelId,
        parallelCount: parallelState.parallelCount,
        waiting: true,
        message: 'Waiting for iterations to complete',
      }
    }),
  }
})

/**
 * Create an input resolver mock that handles parallel references
 */
export const createParallelInputResolver = (distributionData: any) => ({
  InputResolver: vi.fn().mockImplementation(() => ({
    resolveInputs: vi.fn().mockImplementation((block, context) => {
      if (block.metadata?.id === 'function') {
        const virtualBlockId = context.currentVirtualBlockId
        if (virtualBlockId && context.parallelBlockMapping) {
          const mapping = context.parallelBlockMapping.get(virtualBlockId)
          if (mapping) {
            if (Array.isArray(distributionData)) {
              const currentItem = distributionData[mapping.iterationIndex]
              const currentIndex = mapping.iterationIndex
              return {
                code: `return { item: "${currentItem}", index: ${currentIndex} }`,
              }
            }
            if (typeof distributionData === 'object') {
              const entries = Object.entries(distributionData)
              const [key, value] = entries[mapping.iterationIndex]
              return {
                code: `return { key: "${key}", value: "${value}" }`,
              }
            }
          }
        }
      }
      return {}
    }),
  })),
})

/**
 * Create a workflow with parallel blocks for testing
 */
export const createWorkflowWithParallelArray = (
  items: any[] = ['apple', 'banana', 'cherry']
): SerializedWorkflow => ({
  version: '2.0',
  blocks: [
    {
      id: 'starter',
      position: { x: 0, y: 0 },
      metadata: { id: 'starter', name: 'Start' },
      config: { tool: 'starter', params: {} },
      inputs: {},
      outputs: {},
      enabled: true,
    },
    {
      id: 'parallel-1',
      position: { x: 100, y: 0 },
      metadata: { id: 'parallel', name: 'Test Parallel' },
      config: { tool: 'parallel', params: {} },
      inputs: {},
      outputs: {},
      enabled: true,
    },
    {
      id: 'function-1',
      position: { x: 200, y: 0 },
      metadata: { id: 'function', name: 'Process Item' },
      config: {
        tool: 'function',
        params: {
          code: 'return { item: <parallel.currentItem>, index: <parallel.index> }',
        },
      },
      inputs: {},
      outputs: {},
      enabled: true,
    },
    {
      id: 'endpoint',
      position: { x: 300, y: 0 },
      metadata: { id: 'generic', name: 'End' },
      config: { tool: 'generic', params: {} },
      inputs: {},
      outputs: {},
      enabled: true,
    },
  ],
  connections: [
    { source: 'starter', target: 'parallel-1' },
    { source: 'parallel-1', target: 'function-1', sourceHandle: 'parallel-start-source' },
    { source: 'parallel-1', target: 'endpoint', sourceHandle: 'parallel-end-source' },
  ],
  loops: {},
  parallels: {
    'parallel-1': {
      id: 'parallel-1',
      nodes: ['function-1'],
      distribution: items,
    },
  },
})

/**
 * Create a workflow with parallel blocks for object distribution
 */
export const createWorkflowWithParallelObject = (
  items: Record<string, any> = { first: 'alpha', second: 'beta', third: 'gamma' }
): SerializedWorkflow => ({
  version: '2.0',
  blocks: [
    {
      id: 'starter',
      position: { x: 0, y: 0 },
      metadata: { id: 'starter', name: 'Start' },
      config: { tool: 'starter', params: {} },
      inputs: {},
      outputs: {},
      enabled: true,
    },
    {
      id: 'parallel-1',
      position: { x: 100, y: 0 },
      metadata: { id: 'parallel', name: 'Test Parallel' },
      config: { tool: 'parallel', params: {} },
      inputs: {},
      outputs: {},
      enabled: true,
    },
    {
      id: 'function-1',
      position: { x: 200, y: 0 },
      metadata: { id: 'function', name: 'Process Entry' },
      config: {
        tool: 'function',
        params: {
          code: 'return { key: <parallel.currentItem.key>, value: <parallel.currentItem.value> }',
        },
      },
      inputs: {},
      outputs: {},
      enabled: true,
    },
    {
      id: 'endpoint',
      position: { x: 300, y: 0 },
      metadata: { id: 'generic', name: 'End' },
      config: { tool: 'generic', params: {} },
      inputs: {},
      outputs: {},
      enabled: true,
    },
  ],
  connections: [
    { source: 'starter', target: 'parallel-1' },
    { source: 'parallel-1', target: 'function-1', sourceHandle: 'parallel-start-source' },
    { source: 'parallel-1', target: 'endpoint', sourceHandle: 'parallel-end-source' },
  ],
  loops: {},
  parallels: {
    'parallel-1': {
      id: 'parallel-1',
      nodes: ['function-1'],
      distribution: items,
    },
  },
})

/**
 * Mock all modules needed for parallel tests
 */
export const setupParallelTestMocks = (options?: {
  distributionData?: any
  maxParallelChecks?: number
}) => {
  // Setup stores
  setupStoreMocks()

  // Setup core executor mocks
  setupExecutorCoreMocks()

  // Setup parallel manager with correct relative path
  vi.doMock('../parallels', () =>
    createParallelManagerMock({
      maxChecks: options?.maxParallelChecks,
    })
  )

  // Setup loop manager with correct relative path
  vi.doMock('../loops', () => createLoopManagerMock())
}

/**
 * Sets up all standard mocks for executor tests
 */
export const setupAllMocks = (options?: {
  isDebugModeEnabled?: boolean
  consoleAddFn?: ReturnType<typeof vi.fn>
  consoleUpdateFn?: ReturnType<typeof vi.fn>
}) => {
  setupHandlerMocks()
  const storeMocks = setupStoreMocks(options)
  setupExecutorCoreMocks()

  return storeMocks
}
