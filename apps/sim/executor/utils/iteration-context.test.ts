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
      subflowId: 'p1',
      subflowType: 'parallel',
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
      subflowId: 'l1',
      subflowType: 'loop',
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

  it('resolves loop-in-parallel (cross-type nesting)', () => {
    const ctx = makeCtx({
      subflowParentMap: new Map([
        ['loop-1__obranch-1', { parentId: 'parallel-1', parentType: 'parallel', branchIndex: 1 }],
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

  it('resolves 3-level parallel nesting with branchIndex entries', () => {
    // P1 → P2 → P3, with P2__obranch-1 and P3__clone0__obranch-1
    const ctx = makeCtx({
      subflowParentMap: new Map([
        ['P2', { parentId: 'P1', parentType: 'parallel', branchIndex: 0 }],
        ['P3', { parentId: 'P2', parentType: 'parallel', branchIndex: 0 }],
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
        ['loop-1__obranch-2', { parentId: 'parallel-1', parentType: 'parallel', branchIndex: 2 }],
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
      subflowId: 'loop-1__obranch-2',
      subflowType: 'loop',
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
})

describe('buildContainerIterationContext', () => {
  it('resolves loop nested inside parallel', () => {
    const ctx = makeCtx({
      subflowParentMap: new Map([
        ['loop-1__obranch-2', { parentId: 'parallel-1', parentType: 'parallel', branchIndex: 2 }],
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
})
