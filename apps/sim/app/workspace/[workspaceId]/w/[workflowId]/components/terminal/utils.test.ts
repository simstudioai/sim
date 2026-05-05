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

vi.mock('@/stores/constants', () => ({
  TERMINAL_BLOCK_COLUMN_WIDTH: { MIN: 120, DEFAULT: 200, MAX: 400 },
}))

import type { ConsoleEntry } from '@/stores/terminal'
import {
  buildEntryTree,
  type EntryNode,
  flattenVisibleExecutionRows,
  groupEntriesByExecution,
} from './utils'

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
  describe('simple loop (no nesting)', () => {
    it('groups entries by loop iteration', () => {
      const entries: ConsoleEntry[] = []
      for (let iter = 0; iter < 3; iter++) {
        entries.push(
          makeEntry({
            blockId: 'function-1',
            blockName: 'Function 1',
            executionOrder: iter + 1,
            iterationType: 'loop',
            iterationCurrent: iter,
            iterationTotal: 3,
            iterationContainerId: 'loop-1',
          })
        )
      }

      const tree = buildEntryTree(entries)

      const subflows = tree.filter((n) => n.nodeType === 'subflow')
      expect(subflows).toHaveLength(1)
      expect(subflows[0].entry.blockType).toBe('loop')
      expect(subflows[0].children).toHaveLength(3)

      for (let i = 0; i < 3; i++) {
        expect(subflows[0].children[i].iterationInfo?.current).toBe(i)
        expect(subflows[0].children[i].children).toHaveLength(1)
        expect(subflows[0].children[i].children[0].entry.blockId).toBe('function-1')
      }
    })
  })

  describe('simple parallel (no nesting)', () => {
    it('groups entries by parallel branch', () => {
      const entries: ConsoleEntry[] = []
      for (let branch = 0; branch < 4; branch++) {
        entries.push(
          makeEntry({
            blockId: 'function-1',
            blockName: 'Function 1',
            executionOrder: branch + 1,
            iterationType: 'parallel',
            iterationCurrent: branch,
            iterationTotal: 4,
            iterationContainerId: 'parallel-1',
          })
        )
      }

      const tree = buildEntryTree(entries)

      const subflows = tree.filter((n) => n.nodeType === 'subflow')
      expect(subflows).toHaveLength(1)
      expect(subflows[0].entry.blockType).toBe('parallel')
      expect(subflows[0].children).toHaveLength(4)
    })
  })

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

    it('works with a regular block alongside', () => {
      const entries = [
        makeEntry({
          blockId: 'start-1',
          blockName: 'Start',
          blockType: 'starter',
          executionOrder: 0,
        }),
        ...makeParallelInLoopEntries(3, 2),
      ]

      const tree = buildEntryTree(entries)

      const regularBlocks = tree.filter((n) => n.nodeType === 'block')
      const subflows = tree.filter((n) => n.nodeType === 'subflow')
      expect(regularBlocks).toHaveLength(1)
      expect(regularBlocks[0].entry.blockId).toBe('start-1')
      expect(subflows).toHaveLength(1)
      expect(subflows[0].children).toHaveLength(3)
    })

    it('works when some iterations also have topLevelIterationEntries', () => {
      const entries: ConsoleEntry[] = [
        // Real top-level entry for loop iteration 0 (from a container event)
        makeEntry({
          blockId: 'parallel-container',
          blockName: 'Parallel',
          blockType: 'parallel',
          executionOrder: 100,
          iterationType: 'loop',
          iterationCurrent: 0,
          iterationTotal: 3,
          iterationContainerId: 'loop-1',
        }),
        ...makeParallelInLoopEntries(3, 2),
      ]

      const tree = buildEntryTree(entries)
      const subflows = tree.filter((n) => n.nodeType === 'subflow')
      expect(subflows).toHaveLength(1)

      // All 3 loop iterations must exist
      expect(subflows[0].children).toHaveLength(3)

      // All 6 Function 1 blocks should appear somewhere in the tree
      const allNodes = collectAllNodes(tree)
      const fnBlocks = allNodes.filter(
        (n) => n.nodeType === 'block' && n.entry.blockId === 'function-1'
      )
      expect(fnBlocks).toHaveLength(6)
    })

    it('handles 2 loop × 3 parallel', () => {
      const entries = makeParallelInLoopEntries(2, 3)
      const tree = buildEntryTree(entries)

      const subflows = tree.filter((n) => n.nodeType === 'subflow')
      expect(subflows).toHaveLength(1)
      expect(subflows[0].children).toHaveLength(2)

      const allNodes = collectAllNodes(tree)
      const blocks = allNodes.filter(
        (n) => n.nodeType === 'block' && n.entry.blockId === 'function-1'
      )
      expect(blocks).toHaveLength(6)
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

  describe('parallel-in-parallel', () => {
    it('creates outer and inner parallel branches', () => {
      const entries: ConsoleEntry[] = []
      let order = 1
      for (let outer = 0; outer < 2; outer++) {
        for (let inner = 0; inner < 3; inner++) {
          entries.push(
            makeEntry({
              blockId: 'function-1',
              blockName: 'Function 1',
              executionOrder: order++,
              iterationType: 'parallel',
              iterationCurrent: inner,
              iterationTotal: 3,
              iterationContainerId: 'inner-parallel',
              parentIterations: [
                {
                  iterationType: 'parallel',
                  iterationCurrent: outer,
                  iterationTotal: 2,
                  iterationContainerId: 'outer-parallel',
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

      // 2 outer branches
      expect(subflows[0].children).toHaveLength(2)

      for (let outer = 0; outer < 2; outer++) {
        const outerBranch = subflows[0].children[outer]
        const innerSubflows = outerBranch.children.filter((n) => n.nodeType === 'subflow')
        expect(innerSubflows).toHaveLength(1)
        expect(innerSubflows[0].children).toHaveLength(3)
      }

      const allNodes = collectAllNodes(tree)
      const blocks = allNodes.filter((n) => n.nodeType === 'block')
      expect(blocks).toHaveLength(6)
    })
  })
})

describe('groupEntriesByExecution', () => {
  it('builds tree for parallel-in-loop via groupEntriesByExecution', () => {
    const entries = makeParallelInLoopEntries(3, 2)

    const groups = groupEntriesByExecution(entries)
    expect(groups).toHaveLength(1)

    const entryTree = groups[0].entryTree
    const subflows = entryTree.filter((n) => n.nodeType === 'subflow')
    expect(subflows).toHaveLength(1)
    expect(subflows[0].children).toHaveLength(3)
  })

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

  it('subflow container with concurrent children uses wall-clock duration', () => {
    const branches = 4
    const branchDurationMs = 60_000
    const startMs = Date.UTC(2025, 0, 1, 0, 0, 0)
    const endMs = startMs + branchDurationMs

    const entries: ConsoleEntry[] = []
    for (let branch = 0; branch < branches; branch++) {
      entries.push(
        makeEntry({
          blockId: 'function-1',
          executionOrder: branch + 1,
          startedAt: new Date(startMs).toISOString(),
          endedAt: new Date(endMs).toISOString(),
          durationMs: branchDurationMs,
          iterationType: 'parallel',
          iterationCurrent: branch,
          iterationTotal: branches,
          iterationContainerId: 'parallel-1',
        })
      )
    }

    const tree = buildEntryTree(entries)
    const subflow = tree.find((n) => n.entry.blockType === 'parallel')
    expect(subflow).toBeDefined()
    expect(subflow!.entry.durationMs).toBe(branchDurationMs)
    expect(subflow!.entry.durationMs).toBeLessThan(branches * branchDurationMs)
  })

  it('sequential loop iteration uses wall-clock duration', () => {
    const blockStart = Date.UTC(2025, 0, 1, 0, 0, 0)
    const blockEnd = blockStart + 5_000

    const entries: ConsoleEntry[] = [
      makeEntry({
        blockId: 'function-1',
        executionOrder: 1,
        startedAt: new Date(blockStart).toISOString(),
        endedAt: new Date(blockEnd).toISOString(),
        durationMs: 5_000,
        iterationType: 'loop',
        iterationCurrent: 0,
        iterationTotal: 1,
        iterationContainerId: 'loop-1',
      }),
    ]

    const tree = buildEntryTree(entries)
    const loop = tree.find((n) => n.entry.blockType === 'loop')
    expect(loop).toBeDefined()
    expect(loop!.children[0].entry.durationMs).toBe(5_000)
  })

  it('parallel iteration uses wall-clock duration', () => {
    const start = Date.UTC(2025, 0, 1, 0, 0, 0)
    const end = start + 7_500

    const entries: ConsoleEntry[] = [
      makeEntry({
        blockId: 'function-1',
        executionOrder: 1,
        startedAt: new Date(start).toISOString(),
        endedAt: new Date(end).toISOString(),
        durationMs: 7_500,
        iterationType: 'parallel',
        iterationCurrent: 0,
        iterationTotal: 1,
        iterationContainerId: 'parallel-1',
      }),
    ]

    const tree = buildEntryTree(entries)
    const parallel = tree.find((n) => n.entry.blockType === 'parallel')
    expect(parallel).toBeDefined()
    expect(parallel!.children[0].entry.durationMs).toBe(7_500)
  })

  it('sequential loop with gaps between iterations: each iteration is wall-clock of its own children', () => {
    const entries: ConsoleEntry[] = []
    const iterStarts = [0, 10_000, 30_000]
    const blockDuration = 1_000
    const base = Date.UTC(2025, 0, 1, 0, 0, 0)

    for (let i = 0; i < iterStarts.length; i++) {
      entries.push(
        makeEntry({
          blockId: 'function-1',
          executionOrder: i + 1,
          startedAt: new Date(base + iterStarts[i]).toISOString(),
          endedAt: new Date(base + iterStarts[i] + blockDuration).toISOString(),
          durationMs: blockDuration,
          iterationType: 'loop',
          iterationCurrent: i,
          iterationTotal: 3,
          iterationContainerId: 'loop-1',
        })
      )
    }

    const tree = buildEntryTree(entries)
    const loop = tree.find((n) => n.entry.blockType === 'loop')!
    for (let i = 0; i < 3; i++) {
      expect(loop.children[i].entry.durationMs).toBe(blockDuration)
    }
    expect(loop.entry.durationMs).toBe(iterStarts[2] + blockDuration - iterStarts[0])
  })

  it('loop-in-loop: outer iteration duration spans all inner iterations wall-clock', () => {
    const entries: ConsoleEntry[] = []
    const base = Date.UTC(2025, 0, 1, 0, 0, 0)
    const innerDuration = 2_000
    const innerCount = 3

    for (let inner = 0; inner < innerCount; inner++) {
      const start = base + inner * innerDuration
      entries.push(
        makeEntry({
          blockId: 'function-1',
          executionOrder: inner + 1,
          startedAt: new Date(start).toISOString(),
          endedAt: new Date(start + innerDuration).toISOString(),
          durationMs: innerDuration,
          iterationType: 'loop',
          iterationCurrent: inner,
          iterationTotal: innerCount,
          iterationContainerId: 'inner-loop',
          parentIterations: [
            {
              iterationType: 'loop',
              iterationCurrent: 0,
              iterationTotal: 1,
              iterationContainerId: 'outer-loop',
            },
          ],
        })
      )
    }

    const tree = buildEntryTree(entries)
    const outerLoop = tree.find((n) => n.entry.blockType === 'loop')!
    const outerIter = outerLoop.children[0]
    expect(outerIter.entry.durationMs).toBe(innerCount * innerDuration)
  })

  it('loop-in-parallel: each branch duration reflects its own loop wall-clock', () => {
    const entries: ConsoleEntry[] = []
    const base = Date.UTC(2025, 0, 1, 0, 0, 0)
    const innerDuration = 1_500
    const innerCount = 2
    const branches = 3

    for (let branch = 0; branch < branches; branch++) {
      for (let inner = 0; inner < innerCount; inner++) {
        const start = base + inner * innerDuration
        entries.push(
          makeEntry({
            blockId: 'function-1',
            executionOrder: branch * innerCount + inner + 1,
            startedAt: new Date(start).toISOString(),
            endedAt: new Date(start + innerDuration).toISOString(),
            durationMs: innerDuration,
            iterationType: 'loop',
            iterationCurrent: inner,
            iterationTotal: innerCount,
            iterationContainerId: 'inner-loop',
            parentIterations: [
              {
                iterationType: 'parallel',
                iterationCurrent: branch,
                iterationTotal: branches,
                iterationContainerId: 'parallel-1',
              },
            ],
          })
        )
      }
    }

    const tree = buildEntryTree(entries)
    const parallelSubflow = tree.find((n) => n.entry.blockType === 'parallel')!
    expect(parallelSubflow.children).toHaveLength(branches)
    for (let branch = 0; branch < branches; branch++) {
      const branchNode = parallelSubflow.children[branch]
      expect(branchNode.entry.durationMs).toBe(innerCount * innerDuration)
    }
    expect(parallelSubflow.entry.durationMs).toBe(innerCount * innerDuration)
  })

  it('single-block iteration: duration equals the block durationMs', () => {
    const start = Date.UTC(2025, 0, 1, 0, 0, 0)
    const blockDuration = 3_141

    const entries: ConsoleEntry[] = [
      makeEntry({
        blockId: 'function-1',
        executionOrder: 1,
        startedAt: new Date(start).toISOString(),
        endedAt: new Date(start + blockDuration).toISOString(),
        durationMs: blockDuration,
        iterationType: 'loop',
        iterationCurrent: 0,
        iterationTotal: 1,
        iterationContainerId: 'loop-1',
      }),
    ]

    const tree = buildEntryTree(entries)
    const loop = tree.find((n) => n.entry.blockType === 'loop')!
    expect(loop.children[0].entry.durationMs).toBe(blockDuration)
    expect(loop.entry.durationMs).toBe(blockDuration)
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

describe('flattenVisibleExecutionRows', () => {
  it('only includes children for expanded nodes', () => {
    const childBlock = makeEntry({
      id: 'child',
      blockId: 'child',
      blockName: 'Child',
      blockType: 'function',
      executionId: 'exec-1',
      executionOrder: 2,
    })

    const tree: EntryNode[] = [
      {
        entry: makeEntry({
          id: 'workflow-parent',
          blockId: 'workflow-parent',
          blockName: 'Workflow Parent',
          blockType: 'workflow',
          executionId: 'exec-1',
          executionOrder: 1,
        }),
        children: [{ entry: childBlock, children: [], nodeType: 'block' }],
        nodeType: 'workflow',
      },
    ]

    const rowsCollapsed = flattenVisibleExecutionRows(
      [
        {
          executionId: 'exec-1',
          startTime: '2025-01-01T00:00:00Z',
          endTime: '2025-01-01T00:00:01Z',
          startTimeMs: 0,
          endTimeMs: 1,
          duration: 1,
          status: 'success',
          entries: [],
          entryTree: tree,
        },
      ],
      new Set()
    )

    expect(rowsCollapsed).toHaveLength(1)
    expect(rowsCollapsed[0].node?.entry.id).toBe('workflow-parent')

    const rowsExpanded = flattenVisibleExecutionRows(
      [
        {
          executionId: 'exec-1',
          startTime: '2025-01-01T00:00:00Z',
          endTime: '2025-01-01T00:00:01Z',
          startTimeMs: 0,
          endTimeMs: 1,
          duration: 1,
          status: 'success',
          entries: [],
          entryTree: tree,
        },
      ],
      new Set(['workflow-parent'])
    )

    expect(rowsExpanded).toHaveLength(2)
    expect(rowsExpanded[1].node?.entry.id).toBe('child')
    expect(rowsExpanded[1].depth).toBe(1)
  })
})
