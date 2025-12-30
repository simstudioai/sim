import { expect } from 'vitest'

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Asserts that a block exists in the workflow.
 *
 * @example
 * ```ts
 * const workflow = createLinearWorkflow(3)
 * expectBlockExists(workflow.blocks, 'block-0')
 * expectBlockExists(workflow.blocks, 'block-0', 'starter')
 * ```
 */
export function expectBlockExists(
  blocks: Record<string, any>,
  blockId: string,
  expectedType?: string
): void {
  expect(blocks[blockId], `Block "${blockId}" should exist`).toBeDefined()
  expect(blocks[blockId].id).toBe(blockId)
  if (expectedType) {
    expect(blocks[blockId].type, `Block "${blockId}" should be type "${expectedType}"`).toBe(
      expectedType
    )
  }
}

/**
 * Asserts that a block does NOT exist in the workflow.
 *
 * @example
 * ```ts
 * expectBlockNotExists(workflow.blocks, 'deleted-block')
 * ```
 */
export function expectBlockNotExists(blocks: Record<string, any>, blockId: string): void {
  expect(blocks[blockId], `Block "${blockId}" should not exist`).toBeUndefined()
}

/**
 * Asserts that an edge connects two blocks.
 *
 * @example
 * ```ts
 * expectEdgeConnects(workflow.edges, 'block-0', 'block-1')
 * ```
 */
export function expectEdgeConnects(edges: any[], sourceId: string, targetId: string): void {
  const edge = edges.find((e) => e.source === sourceId && e.target === targetId)
  expect(edge, `Edge from "${sourceId}" to "${targetId}" should exist`).toBeDefined()
}

/**
 * Asserts that no edge connects two blocks.
 *
 * @example
 * ```ts
 * expectNoEdgeBetween(workflow.edges, 'block-1', 'block-0') // No reverse edge
 * ```
 */
export function expectNoEdgeBetween(edges: any[], sourceId: string, targetId: string): void {
  const edge = edges.find((e) => e.source === sourceId && e.target === targetId)
  expect(edge, `Edge from "${sourceId}" to "${targetId}" should not exist`).toBeUndefined()
}

/**
 * Asserts that a block has a specific parent.
 *
 * @example
 * ```ts
 * expectBlockHasParent(workflow.blocks, 'child-block', 'loop-1')
 * ```
 */
export function expectBlockHasParent(
  blocks: Record<string, any>,
  childId: string,
  expectedParentId: string
): void {
  const block = blocks[childId]
  expect(block, `Child block "${childId}" should exist`).toBeDefined()
  expect(block.data?.parentId, `Block "${childId}" should have parent "${expectedParentId}"`).toBe(
    expectedParentId
  )
}

/**
 * Asserts that a workflow has a specific number of blocks.
 *
 * @example
 * ```ts
 * expectBlockCount(workflow, 5)
 * ```
 */
export function expectBlockCount(workflow: any, expectedCount: number): void {
  const actualCount = Object.keys(workflow.blocks).length
  expect(actualCount, `Workflow should have ${expectedCount} blocks`).toBe(expectedCount)
}

/**
 * Asserts that a workflow has a specific number of edges.
 *
 * @example
 * ```ts
 * expectEdgeCount(workflow, 4)
 * ```
 */
export function expectEdgeCount(workflow: any, expectedCount: number): void {
  expect(workflow.edges.length, `Workflow should have ${expectedCount} edges`).toBe(expectedCount)
}

/**
 * Asserts that a block is at a specific position.
 *
 * @example
 * ```ts
 * expectBlockPosition(workflow.blocks, 'block-1', { x: 200, y: 0 })
 * ```
 */
export function expectBlockPosition(
  blocks: Record<string, any>,
  blockId: string,
  expectedPosition: { x: number; y: number }
): void {
  const block = blocks[blockId]
  expect(block, `Block "${blockId}" should exist`).toBeDefined()
  expect(block.position.x, `Block "${blockId}" x position`).toBeCloseTo(expectedPosition.x, 0)
  expect(block.position.y, `Block "${blockId}" y position`).toBeCloseTo(expectedPosition.y, 0)
}

/**
 * Asserts that a block is enabled.
 *
 * @example
 * ```ts
 * expectBlockEnabled(workflow.blocks, 'block-1')
 * ```
 */
export function expectBlockEnabled(blocks: Record<string, any>, blockId: string): void {
  const block = blocks[blockId]
  expect(block, `Block "${blockId}" should exist`).toBeDefined()
  expect(block.enabled, `Block "${blockId}" should be enabled`).toBe(true)
}

/**
 * Asserts that a block is disabled.
 *
 * @example
 * ```ts
 * expectBlockDisabled(workflow.blocks, 'disabled-block')
 * ```
 */
export function expectBlockDisabled(blocks: Record<string, any>, blockId: string): void {
  const block = blocks[blockId]
  expect(block, `Block "${blockId}" should exist`).toBeDefined()
  expect(block.enabled, `Block "${blockId}" should be disabled`).toBe(false)
}

/**
 * Asserts that a workflow has a loop with specific configuration.
 *
 * @example
 * ```ts
 * expectLoopExists(workflow, 'loop-1', { iterations: 5, loopType: 'for' })
 * ```
 */
export function expectLoopExists(
  workflow: any,
  loopId: string,
  expectedConfig?: { iterations?: number; loopType?: string; nodes?: string[] }
): void {
  const loop = workflow.loops[loopId]
  expect(loop, `Loop "${loopId}" should exist`).toBeDefined()

  if (expectedConfig) {
    if (expectedConfig.iterations !== undefined) {
      expect(loop.iterations).toBe(expectedConfig.iterations)
    }
    if (expectedConfig.loopType !== undefined) {
      expect(loop.loopType).toBe(expectedConfig.loopType)
    }
    if (expectedConfig.nodes !== undefined) {
      expect(loop.nodes).toEqual(expectedConfig.nodes)
    }
  }
}

/**
 * Asserts that a workflow has a parallel block with specific configuration.
 *
 * @example
 * ```ts
 * expectParallelExists(workflow, 'parallel-1', { count: 3 })
 * ```
 */
export function expectParallelExists(
  workflow: any,
  parallelId: string,
  expectedConfig?: { count?: number; parallelType?: string; nodes?: string[] }
): void {
  const parallel = workflow.parallels[parallelId]
  expect(parallel, `Parallel "${parallelId}" should exist`).toBeDefined()

  if (expectedConfig) {
    if (expectedConfig.count !== undefined) {
      expect(parallel.count).toBe(expectedConfig.count)
    }
    if (expectedConfig.parallelType !== undefined) {
      expect(parallel.parallelType).toBe(expectedConfig.parallelType)
    }
    if (expectedConfig.nodes !== undefined) {
      expect(parallel.nodes).toEqual(expectedConfig.nodes)
    }
  }
}

/**
 * Asserts that the workflow state is empty.
 *
 * @example
 * ```ts
 * const workflow = createWorkflowState()
 * expectEmptyWorkflow(workflow)
 * ```
 */
export function expectEmptyWorkflow(workflow: any): void {
  expect(Object.keys(workflow.blocks).length, 'Workflow should have no blocks').toBe(0)
  expect(workflow.edges.length, 'Workflow should have no edges').toBe(0)
  expect(Object.keys(workflow.loops).length, 'Workflow should have no loops').toBe(0)
  expect(Object.keys(workflow.parallels).length, 'Workflow should have no parallels').toBe(0)
}

/**
 * Asserts that blocks are connected in a linear chain.
 *
 * @example
 * ```ts
 * expectLinearChain(workflow.edges, ['start', 'step1', 'step2', 'end'])
 * ```
 */
export function expectLinearChain(edges: any[], blockIds: string[]): void {
  for (let i = 0; i < blockIds.length - 1; i++) {
    expectEdgeConnects(edges, blockIds[i], blockIds[i + 1])
  }
}
