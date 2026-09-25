import { describe, expect, it, vi } from 'vitest'

vi.mock('@/blocks', () => ({
  getBlock: vi.fn().mockReturnValue(null),
}))

vi.mock('@/executor/constants', () => ({
  isSubExecutionBlockType: vi.fn((blockType: string | undefined) => {
    return (
      blockType === 'workflow' ||
      blockType === 'workflow_input' ||
      blockType?.startsWith('custom_block_') === true
    )
  }),
}))

vi.mock('@/stores/constants', () => ({
  TERMINAL_BLOCK_COLUMN_WIDTH: { MIN: 120, DEFAULT: 200, MAX: 400 },
}))

import type { ConsoleEntry } from '@/stores/terminal'
import { buildEntryTree, type EntryNode, groupEntriesByExecution } from './utils'

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

/** Collect all nodes from a tree depth-first */
function collectAllNodes(nodes: EntryNode[]): EntryNode[] {
  const result: EntryNode[] = []
  for (const node of nodes) {
    result.push(node)
    result.push(...collectAllNodes(node.children))
  }
  return result
}

/**
 * Creates entries for a parallel-in-loop scenario.
 * All Function 1 entries are nestedIterationEntries (have parentIterations).
 * No topLevelIterationEntries exist (sentinels don't emit SSE events).
 */
function makeParallelInLoopEntries(
  loopIterations: number,
  parallelBranches: number
): ConsoleEntry[] {
  const entries: ConsoleEntry[] = []
  let order = 1
  for (let loopIter = 0; loopIter < loopIterations; loopIter++) {
    for (let branch = 0; branch < parallelBranches; branch++) {
      entries.push(
        makeEntry({
          blockId: 'function-1',
          blockName: 'Function 1',
          executionOrder: order++,
          startedAt: new Date(Date.UTC(2025, 0, 1, 0, 0, loopIter * 10 + branch)).toISOString(),
          endedAt: new Date(Date.UTC(2025, 0, 1, 0, 0, loopIter * 10 + branch + 1)).toISOString(),
          durationMs: 50,
          iterationType: 'parallel',
          iterationCurrent: branch,
          iterationTotal: parallelBranches,
          iterationContainerId: 'parallel-1',
          parentIterations: [
            {
              iterationType: 'loop',
              iterationCurrent: loopIter,
              iterationTotal: loopIterations,
              iterationContainerId: 'loop-1',
            },
          ],
        })
      )
    }
  }
  return entries
}

describe('buildEntryTree', () => {
  describe('parallel-in-loop', () => {
    it('creates all loop iterations (5 loop × 5 parallel)', () => {
      const entries = makeParallelInLoopEntries(5, 5)
      expect(entries).toHaveLength(25)

      const tree = buildEntryTree(entries)

      // Top level: 1 subflow (Loop)
      const subflows = tree.filter((n) => n.nodeType === 'subflow')
      expect(subflows).toHaveLength(1)
      expect(subflows[0].entry.blockType).toBe('loop')

      // Loop has 5 iteration children
      const loopIterations = subflows[0].children
      expect(loopIterations).toHaveLength(5)

      for (let loopIter = 0; loopIter < 5; loopIter++) {
        const iterNode = loopIterations[loopIter]
        expect(iterNode.nodeType).toBe('iteration')
        expect(iterNode.iterationInfo?.current).toBe(loopIter)
        expect(iterNode.iterationInfo?.total).toBe(5)

        // Each loop iteration has 1 nested subflow (Parallel)
        const parallelSubflows = iterNode.children.filter((n) => n.nodeType === 'subflow')
        expect(parallelSubflows).toHaveLength(1)
        expect(parallelSubflows[0].entry.blockType).toBe('parallel')

        // Each parallel has 5 branch iterations
        const branches = parallelSubflows[0].children
        expect(branches).toHaveLength(5)
        for (let branch = 0; branch < 5; branch++) {
          expect(branches[branch].iterationInfo?.current).toBe(branch)
          expect(branches[branch].children).toHaveLength(1)
          expect(branches[branch].children[0].entry.blockId).toBe('function-1')
        }
      }
    })

    it('preserves all block entries in the tree (no silently dropped entries)', () => {
      const entries = makeParallelInLoopEntries(5, 5)
      const tree = buildEntryTree(entries)

      const allNodes = collectAllNodes(tree)
      const blocks = allNodes.filter(
        (n) => n.nodeType === 'block' && n.entry.blockId === 'function-1'
      )
      expect(blocks).toHaveLength(25)
    })
  })

  describe('loop-in-parallel', () => {
    it('creates all parallel branches with nested loop iterations', () => {
      const entries: ConsoleEntry[] = []
      let order = 1
      for (let branch = 0; branch < 3; branch++) {
        for (let loopIter = 0; loopIter < 2; loopIter++) {
          entries.push(
            makeEntry({
              blockId: 'function-1',
              blockName: 'Function 1',
              executionOrder: order++,
              iterationType: 'loop',
              iterationCurrent: loopIter,
              iterationTotal: 2,
              iterationContainerId: 'loop-1',
              parentIterations: [
                {
                  iterationType: 'parallel',
                  iterationCurrent: branch,
                  iterationTotal: 3,
                  iterationContainerId: 'parallel-1',
                },
              ],
            })
          )
        }
      }

      const tree = buildEntryTree(entries)

      const subflows = tree.filter((n) => n.nodeType === 'subflow')
      expect(subflows).toHaveLength(1)
      expect(subflows[0].entry.blockType).toBe('parallel')

      // 3 parallel branches
      const branches = subflows[0].children
      expect(branches).toHaveLength(3)

      for (let branch = 0; branch < 3; branch++) {
        const branchNode = branches[branch]
        expect(branchNode.iterationInfo?.current).toBe(branch)

        // Each branch has a nested loop subflow
        const nestedSubflows = branchNode.children.filter((n) => n.nodeType === 'subflow')
        expect(nestedSubflows).toHaveLength(1)
        expect(nestedSubflows[0].entry.blockType).toBe('loop')

        // Each loop has 2 iterations
        expect(nestedSubflows[0].children).toHaveLength(2)
      }
    })
  })

  describe('loop-in-loop', () => {
    it('creates outer and inner loop iterations', () => {
      const entries: ConsoleEntry[] = []
      let order = 1
      for (let outer = 0; outer < 2; outer++) {
        for (let inner = 0; inner < 3; inner++) {
          entries.push(
            makeEntry({
              blockId: 'function-1',
              blockName: 'Function 1',
              executionOrder: order++,
              iterationType: 'loop',
              iterationCurrent: inner,
              iterationTotal: 3,
              iterationContainerId: 'inner-loop',
              parentIterations: [
                {
                  iterationType: 'loop',
                  iterationCurrent: outer,
                  iterationTotal: 2,
                  iterationContainerId: 'outer-loop',
                },
              ],
            })
          )
        }
      }

      const tree = buildEntryTree(entries)

      const subflows = tree.filter((n) => n.nodeType === 'subflow')
      expect(subflows).toHaveLength(1)
      expect(subflows[0].entry.blockType).toBe('loop')

      // Outer loop: 2 iterations
      expect(subflows[0].children).toHaveLength(2)

      for (let outer = 0; outer < 2; outer++) {
        const outerIter = subflows[0].children[outer]
        expect(outerIter.iterationInfo?.current).toBe(outer)

        // Each outer iteration has an inner loop
        const innerSubflows = outerIter.children.filter((n) => n.nodeType === 'subflow')
        expect(innerSubflows).toHaveLength(1)
        expect(innerSubflows[0].children).toHaveLength(3)
      }

      // All 6 blocks present
      const allNodes = collectAllNodes(tree)
      const blocks = allNodes.filter((n) => n.nodeType === 'block')
      expect(blocks).toHaveLength(6)
    })
  })
})

describe('groupEntriesByExecution', () => {
  it('handles workflow child entries alongside iteration entries', () => {
    const entries: ConsoleEntry[] = [
      makeEntry({
        id: 'start-entry',
        blockId: 'start',
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
    expect(tree.length).toBeGreaterThanOrEqual(2)

    const startNode = tree.find((n) => n.entry.blockType === 'start_trigger')
    expect(startNode).toBeDefined()

    // Child entry should be nested under workflow block, not at top level
    const topLevelChild = tree.find((n) => n.entry.blockId === 'child-func')
    expect(topLevelChild).toBeUndefined()
  })
})

describe('duration computation', () => {
  /**
   * Regression guard for the 18m → 20m → 22m bug.
   *
   * When a loop iteration contains a parallel block, the iteration's displayed
   * duration must be wall-clock (max(endedAt) − min(startedAt)), not the sum of
   * child durationMs. Summing over concurrent parallel branches over-counts time
   * and causes the displayed iteration duration to climb rapidly as each branch
   * resolves.
   */
  it('loop iteration with concurrent parallel branches uses wall-clock duration', () => {
    const branches = 5
    const branchDurationMs = 110_000
    const loopIterStartMs = Date.UTC(2025, 0, 1, 0, 0, 0)
    const loopIterEndMs = loopIterStartMs + branchDurationMs

    const entries: ConsoleEntry[] = []
    for (let branch = 0; branch < branches; branch++) {
      entries.push(
        makeEntry({
          blockId: 'function-1',
          blockName: 'Function 1',
          executionOrder: branch + 1,
          startedAt: new Date(loopIterStartMs).toISOString(),
          endedAt: new Date(loopIterEndMs).toISOString(),
          durationMs: branchDurationMs,
          iterationType: 'parallel',
          iterationCurrent: branch,
          iterationTotal: branches,
          iterationContainerId: 'parallel-1',
          parentIterations: [
            {
              iterationType: 'loop',
              iterationCurrent: 0,
              iterationTotal: 1,
              iterationContainerId: 'loop-1',
            },
          ],
        })
      )
    }

    const tree = buildEntryTree(entries)
    const loopSubflow = tree.find((n) => n.entry.blockType === 'loop')
    expect(loopSubflow).toBeDefined()

    const iteration = loopSubflow!.children[0]
    expect(iteration.nodeType).toBe('iteration')
    expect(iteration.entry.durationMs).toBe(branchDurationMs)
    expect(iteration.entry.durationMs).toBeLessThan(branches * branchDurationMs)
  })

  it('does not sum concurrent branch durations into iteration duration', () => {
    const branches = 20
    const branchDurationMs = 100_000
    const start = Date.UTC(2025, 0, 1, 0, 0, 0)

    const entries: ConsoleEntry[] = []
    for (let branch = 0; branch < branches; branch++) {
      const branchStart = start + branch * 5
      entries.push(
        makeEntry({
          blockId: 'function-1',
          executionOrder: branch + 1,
          startedAt: new Date(branchStart).toISOString(),
          endedAt: new Date(branchStart + branchDurationMs).toISOString(),
          durationMs: branchDurationMs,
          iterationType: 'parallel',
          iterationCurrent: branch,
          iterationTotal: branches,
          iterationContainerId: 'parallel-1',
          parentIterations: [
            {
              iterationType: 'loop',
              iterationCurrent: 0,
              iterationTotal: 1,
              iterationContainerId: 'loop-1',
            },
          ],
        })
      )
    }

    const tree = buildEntryTree(entries)
    const loopSubflow = tree.find((n) => n.entry.blockType === 'loop')!
    const iteration = loopSubflow.children[0]

    const wallClock = branchDurationMs + (branches - 1) * 5
    expect(iteration.entry.durationMs).toBe(wallClock)
    expect(iteration.entry.durationMs).toBeLessThan(branches * branchDurationMs)
  })
})
