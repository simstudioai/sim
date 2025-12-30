import { createBlock, createFunctionBlock, createStarterBlock } from './block.factory'
import { createLinearEdges } from './edge.factory'

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Options for creating a mock workflow state.
 * Uses `any` for complex types to avoid conflicts with app types.
 */
export interface WorkflowFactoryOptions {
  blocks?: Record<string, any>
  edges?: any[]
  loops?: Record<string, any>
  parallels?: Record<string, any>
  lastSaved?: number
  isDeployed?: boolean
  variables?: any[]
}

/**
 * Creates an empty workflow state with defaults.
 *
 * @example
 * ```ts
 * const workflow = createWorkflowState()
 * ```
 */
export function createWorkflowState(options: WorkflowFactoryOptions = {}): any {
  return {
    blocks: options.blocks ?? {},
    edges: options.edges ?? [],
    loops: options.loops ?? {},
    parallels: options.parallels ?? {},
    lastSaved: options.lastSaved ?? Date.now(),
    isDeployed: options.isDeployed ?? false,
    variables: options.variables,
  }
}

/**
 * Creates a simple linear workflow with the specified number of blocks.
 * First block is always a starter, rest are function blocks.
 *
 * @example
 * ```ts
 * // Creates: starter -> function -> function
 * const workflow = createLinearWorkflow(3)
 * ```
 */
export function createLinearWorkflow(blockCount: number, spacing = 200): any {
  if (blockCount < 1) {
    return createWorkflowState()
  }

  const blocks: Record<string, any> = {}
  const blockIds: string[] = []

  for (let i = 0; i < blockCount; i++) {
    const id = `block-${i}`
    blockIds.push(id)

    if (i === 0) {
      blocks[id] = createStarterBlock({
        id,
        position: { x: i * spacing, y: 0 },
      })
    } else {
      blocks[id] = createFunctionBlock({
        id,
        name: `Step ${i}`,
        position: { x: i * spacing, y: 0 },
      })
    }
  }

  return createWorkflowState({
    blocks,
    edges: createLinearEdges(blockIds),
  })
}

/**
 * Creates a workflow with a branching condition.
 *
 * Structure:
 * ```
 *           ┌─→ true-branch ─┐
 * start ─→ condition         ├─→ end
 *           └─→ false-branch ┘
 * ```
 */
export function createBranchingWorkflow(): any {
  const blocks: Record<string, any> = {
    start: createStarterBlock({ id: 'start', position: { x: 0, y: 0 } }),
    condition: createBlock({
      id: 'condition',
      type: 'condition',
      name: 'Check',
      position: { x: 200, y: 0 },
    }),
    'true-branch': createFunctionBlock({
      id: 'true-branch',
      name: 'If True',
      position: { x: 400, y: -100 },
    }),
    'false-branch': createFunctionBlock({
      id: 'false-branch',
      name: 'If False',
      position: { x: 400, y: 100 },
    }),
    end: createFunctionBlock({ id: 'end', name: 'End', position: { x: 600, y: 0 } }),
  }

  const edges: any[] = [
    { id: 'e1', source: 'start', target: 'condition' },
    { id: 'e2', source: 'condition', target: 'true-branch', sourceHandle: 'condition-if' },
    { id: 'e3', source: 'condition', target: 'false-branch', sourceHandle: 'condition-else' },
    { id: 'e4', source: 'true-branch', target: 'end' },
    { id: 'e5', source: 'false-branch', target: 'end' },
  ]

  return createWorkflowState({ blocks, edges })
}

/**
 * Creates a workflow with a loop container.
 *
 * Structure:
 * ```
 * start ─→ loop[loop-body] ─→ end
 * ```
 */
export function createLoopWorkflow(iterations = 3): any {
  const blocks: Record<string, any> = {
    start: createStarterBlock({ id: 'start', position: { x: 0, y: 0 } }),
    loop: createBlock({
      id: 'loop',
      type: 'loop',
      name: 'Loop',
      position: { x: 200, y: 0 },
      data: { loopType: 'for', count: iterations, type: 'loop' },
    }),
    'loop-body': createFunctionBlock({
      id: 'loop-body',
      name: 'Loop Body',
      position: { x: 50, y: 50 },
      parentId: 'loop',
    }),
    end: createFunctionBlock({ id: 'end', name: 'End', position: { x: 500, y: 0 } }),
  }

  const edges: any[] = [
    { id: 'e1', source: 'start', target: 'loop' },
    { id: 'e2', source: 'loop', target: 'end' },
  ]

  const loops: Record<string, any> = {
    loop: {
      id: 'loop',
      nodes: ['loop-body'],
      iterations,
      loopType: 'for',
    },
  }

  return createWorkflowState({ blocks, edges, loops })
}

/**
 * Creates a workflow with a parallel container.
 *
 * Structure:
 * ```
 * start ─→ parallel[parallel-task] ─→ end
 * ```
 */
export function createParallelWorkflow(count = 2): any {
  const blocks: Record<string, any> = {
    start: createStarterBlock({ id: 'start', position: { x: 0, y: 0 } }),
    parallel: createBlock({
      id: 'parallel',
      type: 'parallel',
      name: 'Parallel',
      position: { x: 200, y: 0 },
      data: { parallelType: 'count', count, type: 'parallel' },
    }),
    'parallel-task': createFunctionBlock({
      id: 'parallel-task',
      name: 'Parallel Task',
      position: { x: 50, y: 50 },
      parentId: 'parallel',
    }),
    end: createFunctionBlock({ id: 'end', name: 'End', position: { x: 500, y: 0 } }),
  }

  const edges: any[] = [
    { id: 'e1', source: 'start', target: 'parallel' },
    { id: 'e2', source: 'parallel', target: 'end' },
  ]

  const parallels: Record<string, any> = {
    parallel: {
      id: 'parallel',
      nodes: ['parallel-task'],
      count,
      parallelType: 'count',
    },
  }

  return createWorkflowState({ blocks, edges, parallels })
}
