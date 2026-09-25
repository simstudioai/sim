import { expect } from 'vitest'

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
