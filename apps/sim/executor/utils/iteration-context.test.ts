/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { ExecutionContext } from '@/executor/types'
import {
  buildContainerIterationContext,
  buildUnifiedParentIterations,
  getIterationContext,
  type IterationNodeMetadata,
} from './iteration-context'

function makeCtx(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    workflowId: 'wf-1',
    executionId: 'exec-1',
    workspaceId: 'ws-1',
    userId: 'user-1',
    blockStates: {},
    blockLogs: [],
    executedBlocks: [],
    environmentVariables: {},
    decisions: { router: new Map(), condition: new Map() },
    completedLoops: new Set(),
    activeExecutionPath: [],
    executionOrder: 0,
    ...overrides,
  } as unknown as ExecutionContext
}

describe('getIterationContext', () => {
  it('returns undefined for undefined metadata', () => {
    const ctx = makeCtx()
    expect(getIterationContext(ctx, undefined)).toBeUndefined()
  })

  it('resolves parallel branch metadata', () => {
    const ctx = makeCtx({
      parallelExecutions: new Map([
        [
          'p1',
          {
            parallelId: 'p1',
            totalBranches: 3,
            branchOutputs: new Map(),
          },
        ],
      ]),
    })
    const metadata: IterationNodeMetadata = {
      branchIndex: 1,
      branchTotal: 3,
      parallelId: 'p1',
    }
    const result = getIterationContext(ctx, metadata)
    expect(result).toEqual({
      iterationCurrent: 1,
      iterationTotal: 3,
      iterationType: 'parallel',
      iterationContainerId: 'p1',
    })
  })

  it('resolves loop node metadata', () => {
    const ctx = makeCtx({
      loopExecutions: new Map([
        [
          'l1',
          {
            iteration: 2,
            maxIterations: 5,
            currentIterationOutputs: new Map(),
            allIterationOutputs: [],
          },
        ],
      ]),
    })
    const metadata: IterationNodeMetadata = {
      isLoopNode: true,
      loopId: 'l1',
    }
    const result = getIterationContext(ctx, metadata)
    expect(result).toEqual({
      iterationCurrent: 2,
      iterationTotal: 5,
      iterationType: 'loop',
      iterationContainerId: 'l1',
    })
  })
})

describe('buildUnifiedParentIterations', () => {
  it('returns empty array when no parent maps exist', () => {
    const ctx = makeCtx()
    expect(buildUnifiedParentIterations(ctx, 'some-id')).toEqual([])
  })

  it('resolves loop-in-loop parent chain', () => {
    const ctx = makeCtx({
      subflowParentMap: new Map([['inner-loop', { parentId: 'outer-loop', parentType: 'loop' }]]),
      loopExecutions: new Map([
        [
          'outer-loop',
          {
            iteration: 1,
            maxIterations: 3,
            currentIterationOutputs: new Map(),
            allIterationOutputs: [],
          },
        ],
      ]),
    })
    const result = buildUnifiedParentIterations(ctx, 'inner-loop')
    expect(result).toEqual([
      {
        iterationCurrent: 1,
        iterationTotal: 3,
        iterationType: 'loop',
        iterationContainerId: 'outer-loop',
      },
    ])
  })

  it('resolves parallel-in-parallel parent chain', () => {
    const ctx = makeCtx({
      subflowParentMap: new Map([
        ['inner-p__obranch-2', { parentId: 'outer-p', parentType: 'parallel' }],
      ]),
      parallelExecutions: new Map([
        [
          'outer-p',
          {
            parallelId: 'outer-p',
            totalBranches: 4,
            branchOutputs: new Map(),
          },
        ],
      ]),
    })
    const result = buildUnifiedParentIterations(ctx, 'inner-p__obranch-2')
    expect(result).toEqual([
      {
        iterationCurrent: 2,
        iterationTotal: 4,
        iterationType: 'parallel',
        iterationContainerId: 'outer-p',
      },
    ])
  })

  it('resolves loop-in-parallel (cross-type nesting)', () => {
    const ctx = makeCtx({
      subflowParentMap: new Map([
        ['loop-1__obranch-1', { parentId: 'parallel-1', parentType: 'parallel' }],
      ]),
      parallelExecutions: new Map([
        [
          'parallel-1',
          {
            parallelId: 'parallel-1',
            totalBranches: 5,
            branchOutputs: new Map(),
          },
        ],
      ]),
    })
    const result = buildUnifiedParentIterations(ctx, 'loop-1__obranch-1')
    expect(result).toEqual([
      {
        iterationCurrent: 1,
        iterationTotal: 5,
        iterationType: 'parallel',
        iterationContainerId: 'parallel-1',
      },
    ])
  })

  it('resolves parallel-in-loop (cross-type nesting)', () => {
    const ctx = makeCtx({
      subflowParentMap: new Map([['parallel-1', { parentId: 'loop-1', parentType: 'loop' }]]),
      loopExecutions: new Map([
        [
          'loop-1',
          {
            iteration: 3,
            maxIterations: 5,
            currentIterationOutputs: new Map(),
            allIterationOutputs: [],
          },
        ],
      ]),
    })
    const result = buildUnifiedParentIterations(ctx, 'parallel-1')
    expect(result).toEqual([
      {
        iterationCurrent: 3,
        iterationTotal: 5,
        iterationType: 'loop',
        iterationContainerId: 'loop-1',
      },
    ])
  })

  it('resolves deep cross-type nesting: parallel → loop → parallel', () => {
    const ctx = makeCtx({
      subflowParentMap: new Map([
        ['inner-p', { parentId: 'mid-loop', parentType: 'loop' }],
        ['mid-loop', { parentId: 'outer-p', parentType: 'parallel' }],
        ['mid-loop__obranch-2', { parentId: 'outer-p', parentType: 'parallel' }],
      ]),
      loopExecutions: new Map([
        [
          'mid-loop',
          {
            iteration: 1,
            maxIterations: 4,
            currentIterationOutputs: new Map(),
            allIterationOutputs: [],
          },
        ],
      ]),
      parallelExecutions: new Map([
        [
          'outer-p',
          {
            parallelId: 'outer-p',
            totalBranches: 3,
            branchOutputs: new Map(),
          },
        ],
      ]),
    })
    const result = buildUnifiedParentIterations(ctx, 'inner-p')
    expect(result).toEqual([
      {
        iterationCurrent: 0,
        iterationTotal: 3,
        iterationType: 'parallel',
        iterationContainerId: 'outer-p',
      },
      {
        iterationCurrent: 1,
        iterationTotal: 4,
        iterationType: 'loop',
        iterationContainerId: 'mid-loop',
      },
    ])
  })

  it('resolves 3-level parallel nesting with branchIndex entries', () => {
    // P1 → P2 → P3, with P2__obranch-1 and P3__clone0__obranch-1
    const ctx = makeCtx({
      subflowParentMap: new Map([
        ['P2', { parentId: 'P1', parentType: 'parallel' }],
        ['P3', { parentId: 'P2', parentType: 'parallel' }],
        ['P2__obranch-1', { parentId: 'P1', parentType: 'parallel', branchIndex: 1 }],
        [
          'P3__clone0__obranch-1',
          { parentId: 'P2__obranch-1', parentType: 'parallel', branchIndex: 0 },
        ],
        ['P3__obranch-1', { parentId: 'P2', parentType: 'parallel', branchIndex: 1 }],
      ]),
      parallelExecutions: new Map([
        [
          'P1',
          {
            parallelId: 'P1',
            totalBranches: 2,
            branchOutputs: new Map(),
          },
        ],
        [
          'P2',
          {
            parallelId: 'P2',
            totalBranches: 2,
            branchOutputs: new Map(),
          },
        ],
        [
          'P2__obranch-1',
          {
            parallelId: 'P2__obranch-1',
            totalBranches: 2,
            branchOutputs: new Map(),
          },
        ],
      ]),
    })

    // P3 (original): inside P2 branch 0, inside P1 branch 0
    expect(buildUnifiedParentIterations(ctx, 'P3')).toEqual([
      {
        iterationCurrent: 0,
        iterationTotal: 2,
        iterationType: 'parallel',
        iterationContainerId: 'P1',
      },
      {
        iterationCurrent: 0,
        iterationTotal: 2,
        iterationType: 'parallel',
        iterationContainerId: 'P2',
      },
    ])

    // P3__obranch-1 (runtime clone): inside P2 branch 1, inside P1 branch 0
    expect(buildUnifiedParentIterations(ctx, 'P3__obranch-1')).toEqual([
      {
        iterationCurrent: 0,
        iterationTotal: 2,
        iterationType: 'parallel',
        iterationContainerId: 'P1',
      },
      {
        iterationCurrent: 1,
        iterationTotal: 2,
        iterationType: 'parallel',
        iterationContainerId: 'P2',
      },
    ])

    // P3__clone0__obranch-1 (pre-expansion clone): inside P2__obranch-1 branch 0, inside P1 branch 1
    expect(buildUnifiedParentIterations(ctx, 'P3__clone0__obranch-1')).toEqual([
      {
        iterationCurrent: 1,
        iterationTotal: 2,
        iterationType: 'parallel',
        iterationContainerId: 'P1',
      },
      {
        iterationCurrent: 0,
        iterationTotal: 2,
        iterationType: 'parallel',
        iterationContainerId: 'P2__obranch-1',
      },
    ])
  })

  it('includes parent iterations in getIterationContext for loop-in-parallel', () => {
    const ctx = makeCtx({
      subflowParentMap: new Map([
        ['loop-1__obranch-2', { parentId: 'parallel-1', parentType: 'parallel' }],
      ]),
      parallelExecutions: new Map([
        [
          'parallel-1',
          {
            parallelId: 'parallel-1',
            totalBranches: 5,
            branchOutputs: new Map(),
          },
        ],
      ]),
      loopExecutions: new Map([
        [
          'loop-1__obranch-2',
          {
            iteration: 3,
            maxIterations: 5,
            currentIterationOutputs: new Map(),
            allIterationOutputs: [],
          },
        ],
      ]),
    })

    const metadata: IterationNodeMetadata = {
      isLoopNode: true,
      loopId: 'loop-1__obranch-2',
    }
    const result = getIterationContext(ctx, metadata)
    expect(result).toEqual({
      iterationCurrent: 3,
      iterationTotal: 5,
      iterationType: 'loop',
      iterationContainerId: 'loop-1__obranch-2',
      parentIterations: [
        {
          iterationCurrent: 2,
          iterationTotal: 5,
          iterationType: 'parallel',
          iterationContainerId: 'parallel-1',
        },
      ],
    })
  })

  it('includes parent iterations in getIterationContext for parallel-in-loop', () => {
    const ctx = makeCtx({
      subflowParentMap: new Map([['parallel-1', { parentId: 'loop-1', parentType: 'loop' }]]),
      loopExecutions: new Map([
        [
          'loop-1',
          {
            iteration: 2,
            maxIterations: 5,
            currentIterationOutputs: new Map(),
            allIterationOutputs: [],
          },
        ],
      ]),
      parallelExecutions: new Map([
        [
          'parallel-1',
          {
            parallelId: 'parallel-1',
            totalBranches: 3,
            branchOutputs: new Map(),
          },
        ],
      ]),
    })

    const metadata: IterationNodeMetadata = {
      branchIndex: 1,
      branchTotal: 3,
      parallelId: 'parallel-1',
    }
    const result = getIterationContext(ctx, metadata)
    expect(result).toEqual({
      iterationCurrent: 1,
      iterationTotal: 3,
      iterationType: 'parallel',
      iterationContainerId: 'parallel-1',
      parentIterations: [
        {
          iterationCurrent: 2,
          iterationTotal: 5,
          iterationType: 'loop',
          iterationContainerId: 'loop-1',
        },
      ],
    })
  })
})

describe('buildContainerIterationContext', () => {
  it('returns undefined when no parent map exists', () => {
    const ctx = makeCtx()
    expect(buildContainerIterationContext(ctx, 'loop-1')).toBeUndefined()
  })

  it('returns undefined when container is not in parent map', () => {
    const ctx = makeCtx({
      subflowParentMap: new Map(),
    })
    expect(buildContainerIterationContext(ctx, 'loop-1')).toBeUndefined()
  })

  it('resolves loop nested inside parallel', () => {
    const ctx = makeCtx({
      subflowParentMap: new Map([
        ['loop-1__obranch-2', { parentId: 'parallel-1', parentType: 'parallel' }],
      ]),
      parallelExecutions: new Map([
        [
          'parallel-1',
          {
            parallelId: 'parallel-1',
            totalBranches: 5,
            branchOutputs: new Map(),
          },
        ],
      ]),
    })
    const result = buildContainerIterationContext(ctx, 'loop-1__obranch-2')
    expect(result).toEqual({
      iterationCurrent: 2,
      iterationTotal: 5,
      iterationType: 'parallel',
      iterationContainerId: 'parallel-1',
    })
  })

  it('resolves parallel nested inside loop', () => {
    const ctx = makeCtx({
      subflowParentMap: new Map([['parallel-1', { parentId: 'loop-1', parentType: 'loop' }]]),
      loopExecutions: new Map([
        [
          'loop-1',
          {
            iteration: 3,
            maxIterations: 10,
            currentIterationOutputs: new Map(),
            allIterationOutputs: [],
          },
        ],
      ]),
    })
    const result = buildContainerIterationContext(ctx, 'parallel-1')
    expect(result).toEqual({
      iterationCurrent: 3,
      iterationTotal: 10,
      iterationType: 'loop',
      iterationContainerId: 'loop-1',
    })
  })

  it('returns undefined when parent scope is missing', () => {
    const ctx = makeCtx({
      subflowParentMap: new Map([['loop-1', { parentId: 'parallel-1', parentType: 'parallel' }]]),
      parallelExecutions: new Map(),
    })
    expect(buildContainerIterationContext(ctx, 'loop-1')).toBeUndefined()
  })

  it('resolves pre-expansion clone with explicit branchIndex', () => {
    // P1 → P2 → P3: P3__clone0__obranch-1 is pre-cloned inside P2__obranch-1
    const ctx = makeCtx({
      subflowParentMap: new Map([
        [
          'P3__clone0__obranch-1',
          { parentId: 'P2__obranch-1', parentType: 'parallel', branchIndex: 0 },
        ],
      ]),
      parallelExecutions: new Map([
        [
          'P2__obranch-1',
          {
            parallelId: 'P2__obranch-1',
            totalBranches: 5,
            branchOutputs: new Map(),
          },
        ],
      ]),
    })
    const result = buildContainerIterationContext(ctx, 'P3__clone0__obranch-1')
    expect(result).toEqual({
      iterationCurrent: 0,
      iterationTotal: 5,
      iterationType: 'parallel',
      iterationContainerId: 'P2__obranch-1',
    })
  })

  it('uses branch index 0 for non-cloned container in parallel parent', () => {
    const ctx = makeCtx({
      subflowParentMap: new Map([
        ['inner-loop', { parentId: 'outer-parallel', parentType: 'parallel' }],
      ]),
      parallelExecutions: new Map([
        [
          'outer-parallel',
          {
            parallelId: 'outer-parallel',
            totalBranches: 3,
            branchOutputs: new Map(),
          },
        ],
      ]),
    })
    const result = buildContainerIterationContext(ctx, 'inner-loop')
    expect(result).toEqual({
      iterationCurrent: 0,
      iterationTotal: 3,
      iterationType: 'parallel',
      iterationContainerId: 'outer-parallel',
    })
  })
})
