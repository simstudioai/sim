/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/blocks', () => ({
  getBlock: vi.fn().mockReturnValue(null),
}))

vi.mock('@/executor/constants', () => ({
  isWorkflowBlockType: vi.fn((blockType: string | undefined) => {
    return blockType === 'workflow' || blockType === 'workflow_input'
  }),
}))

import type { ConsoleEntry } from '@/stores/terminal'
import { groupEntriesByExecution } from './utils'

let entryCounter = 0

function makeEntry(overrides: Partial<ConsoleEntry>): ConsoleEntry {
  return {
    id: overrides.id ?? `entry-${++entryCounter}`,
    timestamp: overrides.timestamp ?? '2025-01-01T00:00:00Z',
    workflowId: overrides.workflowId ?? 'wf-1',
    blockId: overrides.blockId ?? 'block-1',
    blockName: overrides.blockName ?? 'Block',
    blockType: overrides.blockType ?? 'function',
    executionId: overrides.executionId ?? 'exec-1',
    startedAt: overrides.startedAt ?? '2025-01-01T00:00:00Z',
    executionOrder: overrides.executionOrder ?? 0,
    ...overrides,
  } as ConsoleEntry
}

describe('buildEntryTree via groupEntriesByExecution', () => {
  it('creates synthetic parent groups for orphaned nested iteration entries', () => {
    const outerParallelId = 'outer-parallel'
    const innerParallelId = 'inner-parallel'

    const entries: ConsoleEntry[] = [
      makeEntry({
        id: 'start-entry',
        blockId: 'start',
        blockName: 'Start',
        blockType: 'start_trigger',
        executionOrder: 0,
      }),
      makeEntry({
        id: 'func-0',
        blockId: 'func-1',
        blockName: 'Function 1',
        blockType: 'function',
        executionOrder: 1,
        iterationType: 'parallel',
        iterationCurrent: 0,
        iterationTotal: 3,
        iterationContainerId: innerParallelId,
        parentIterations: [
          {
            iterationCurrent: 0,
            iterationTotal: 2,
            iterationType: 'parallel',
            iterationContainerId: outerParallelId,
          },
        ],
      }),
      makeEntry({
        id: 'func-1',
        blockId: 'func-1',
        blockName: 'Function 1',
        blockType: 'function',
        executionOrder: 2,
        iterationType: 'parallel',
        iterationCurrent: 1,
        iterationTotal: 3,
        iterationContainerId: innerParallelId,
        parentIterations: [
          {
            iterationCurrent: 0,
            iterationTotal: 2,
            iterationType: 'parallel',
            iterationContainerId: outerParallelId,
          },
        ],
      }),
      makeEntry({
        id: 'func-2',
        blockId: 'func-1',
        blockName: 'Function 1',
        blockType: 'function',
        executionOrder: 3,
        iterationType: 'parallel',
        iterationCurrent: 2,
        iterationTotal: 3,
        iterationContainerId: innerParallelId,
        parentIterations: [
          {
            iterationCurrent: 0,
            iterationTotal: 2,
            iterationType: 'parallel',
            iterationContainerId: outerParallelId,
          },
        ],
      }),
    ]

    const groups = groupEntriesByExecution(entries)
    expect(groups).toHaveLength(1)

    const tree = groups[0].entryTree
    // Should have: Start block + outer parallel subflow
    expect(tree).toHaveLength(2)

    const startNode = tree.find((n) => n.entry.blockType === 'start_trigger')
    expect(startNode).toBeDefined()
    expect(startNode!.nodeType).toBe('block')

    // The outer parallel should be a synthetic subflow node
    const outerSubflow = tree.find((n) => n.nodeType === 'subflow')
    expect(outerSubflow).toBeDefined()
    expect(outerSubflow!.entry.blockType).toBe('parallel')

    // Outer subflow should have 1 iteration (iteration 0 of outer)
    expect(outerSubflow!.children).toHaveLength(1)
    const outerIteration = outerSubflow!.children[0]
    expect(outerIteration.nodeType).toBe('iteration')
    expect(outerIteration.iterationInfo?.current).toBe(0)

    // Inside outer iteration: inner parallel subflow (created by recursive buildEntryTree)
    const innerSubflow = outerIteration.children.find((n) => n.nodeType === 'subflow')
    expect(innerSubflow).toBeDefined()
    expect(innerSubflow!.entry.blockType).toBe('parallel')

    // Inner subflow should have 3 iterations
    expect(innerSubflow!.children).toHaveLength(3)
    for (let i = 0; i < 3; i++) {
      const innerIter = innerSubflow!.children[i]
      expect(innerIter.nodeType).toBe('iteration')
      expect(innerIter.iterationInfo?.current).toBe(i)
      // Each iteration should have 1 function block
      expect(innerIter.children).toHaveLength(1)
      expect(innerIter.children[0].entry.blockType).toBe('function')
    }
  })

  it('handles entries with multiple nesting levels in parentIterations', () => {
    const outerParallelId = 'outer'
    const middleParallelId = 'middle'
    const innerParallelId = 'inner'

    const entries: ConsoleEntry[] = [
      makeEntry({
        id: 'func-0',
        blockId: 'func-1',
        blockName: 'Function',
        blockType: 'function',
        executionOrder: 1,
        iterationType: 'parallel',
        iterationCurrent: 0,
        iterationTotal: 2,
        iterationContainerId: innerParallelId,
        parentIterations: [
          {
            iterationCurrent: 0,
            iterationTotal: 2,
            iterationType: 'parallel',
            iterationContainerId: outerParallelId,
          },
          {
            iterationCurrent: 0,
            iterationTotal: 3,
            iterationType: 'parallel',
            iterationContainerId: middleParallelId,
          },
        ],
      }),
    ]

    const groups = groupEntriesByExecution(entries)
    const tree = groups[0].entryTree

    // Outer parallel subflow
    expect(tree).toHaveLength(1)
    const outerSubflow = tree[0]
    expect(outerSubflow.nodeType).toBe('subflow')

    // Outer iteration 0
    expect(outerSubflow.children).toHaveLength(1)
    const outerIter = outerSubflow.children[0]
    expect(outerIter.nodeType).toBe('iteration')

    // Middle parallel subflow (nested)
    const middleSubflow = outerIter.children.find((n) => n.nodeType === 'subflow')
    expect(middleSubflow).toBeDefined()

    // Middle iteration 0
    expect(middleSubflow!.children).toHaveLength(1)
    const middleIter = middleSubflow!.children[0]
    expect(middleIter.nodeType).toBe('iteration')

    // Inner parallel subflow (doubly nested)
    const innerSubflow = middleIter.children.find((n) => n.nodeType === 'subflow')
    expect(innerSubflow).toBeDefined()

    // Inner iteration 0 with the function block
    expect(innerSubflow!.children).toHaveLength(1)
    expect(innerSubflow!.children[0].children).toHaveLength(1)
    expect(innerSubflow!.children[0].children[0].entry.blockType).toBe('function')
  })

  it('creates nested loop-in-loop tree structure', () => {
    const outerLoopId = 'outer-loop'
    const innerLoopId = 'inner-loop'

    const entries: ConsoleEntry[] = [
      makeEntry({
        id: 'outer-0-inner-0',
        blockId: 'func-1',
        blockName: 'Function 1',
        blockType: 'function',
        executionOrder: 1,
        iterationType: 'loop',
        iterationCurrent: 0,
        iterationTotal: 2,
        iterationContainerId: innerLoopId,
        parentIterations: [
          {
            iterationCurrent: 0,
            iterationTotal: 3,
            iterationType: 'loop',
            iterationContainerId: outerLoopId,
          },
        ],
      }),
      makeEntry({
        id: 'outer-0-inner-1',
        blockId: 'func-1',
        blockName: 'Function 1',
        blockType: 'function',
        executionOrder: 2,
        iterationType: 'loop',
        iterationCurrent: 1,
        iterationTotal: 2,
        iterationContainerId: innerLoopId,
        parentIterations: [
          {
            iterationCurrent: 0,
            iterationTotal: 3,
            iterationType: 'loop',
            iterationContainerId: outerLoopId,
          },
        ],
      }),
      makeEntry({
        id: 'outer-1-inner-0',
        blockId: 'func-1',
        blockName: 'Function 1',
        blockType: 'function',
        executionOrder: 3,
        iterationType: 'loop',
        iterationCurrent: 0,
        iterationTotal: 2,
        iterationContainerId: innerLoopId,
        parentIterations: [
          {
            iterationCurrent: 1,
            iterationTotal: 3,
            iterationType: 'loop',
            iterationContainerId: outerLoopId,
          },
        ],
      }),
    ]

    const groups = groupEntriesByExecution(entries)
    const tree = groups[0].entryTree

    // Outer loop subflow
    expect(tree).toHaveLength(1)
    const outerSubflow = tree[0]
    expect(outerSubflow.nodeType).toBe('subflow')
    expect(outerSubflow.entry.blockType).toBe('loop')

    // Outer loop should have 2 iterations (0 and 1)
    expect(outerSubflow.children).toHaveLength(2)
    expect(outerSubflow.children[0].iterationInfo?.current).toBe(0)
    expect(outerSubflow.children[1].iterationInfo?.current).toBe(1)

    // Outer iteration 0 should contain inner loop subflow
    const innerSubflow0 = outerSubflow.children[0].children.find((n) => n.nodeType === 'subflow')
    expect(innerSubflow0).toBeDefined()
    expect(innerSubflow0!.children).toHaveLength(2) // 2 inner iterations

    // Outer iteration 1 should contain inner loop subflow with 1 iteration
    const innerSubflow1 = outerSubflow.children[1].children.find((n) => n.nodeType === 'subflow')
    expect(innerSubflow1).toBeDefined()
    expect(innerSubflow1!.children).toHaveLength(1) // 1 inner iteration
  })

  it('groups workflow block entries into child workflow subtrees', () => {
    const entries: ConsoleEntry[] = [
      makeEntry({
        id: 'parent-start',
        blockId: 'start-block',
        blockName: 'Start',
        blockType: 'start_trigger',
        executionOrder: 0,
      }),
      makeEntry({
        id: 'workflow-block',
        blockId: 'wf-block-1',
        blockName: 'My Sub-Workflow',
        blockType: 'workflow',
        executionOrder: 1,
      }),
      makeEntry({
        id: 'child-block-1',
        blockId: 'child-func',
        blockName: 'Child Function',
        blockType: 'function',
        executionOrder: 2,
        childWorkflowBlockId: 'wf-block-1',
        childWorkflowName: 'Child Workflow',
        childWorkflowInstanceId: 'instance-1',
      }),
    ]

    const groups = groupEntriesByExecution(entries)
    expect(groups).toHaveLength(1)

    const tree = groups[0].entryTree
    // Start block and workflow block at top level
    expect(tree.length).toBeGreaterThanOrEqual(2)

    const startNode = tree.find((n) => n.entry.blockType === 'start_trigger')
    expect(startNode).toBeDefined()

    // The workflow block should exist in the tree
    const wfNode = tree.find(
      (n) => n.entry.blockType === 'workflow' || n.entry.blockId === 'wf-block-1'
    )
    expect(wfNode).toBeDefined()

    // The child entry should be nested under the workflow block, not at top level
    const topLevelChild = tree.find((n) => n.entry.blockId === 'child-func')
    expect(topLevelChild).toBeUndefined()
  })
})
