/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { DAGExecutor } from '@/executor/execution/executor'

function createExecutor(): DAGExecutor {
  return new DAGExecutor({
    workflow: {
      version: '1',
      blocks: [],
      connections: [],
    },
  })
}

describe('DAGExecutor restored cloned subflow registration', () => {
  it('registers restored cloned subflows under their parent parallel branch', () => {
    const executor = createExecutor() as unknown as {
      registerRestoredClonedSubflows: (
        parentMap: Map<
          string,
          { parentId: string; parentType: 'loop' | 'parallel'; branchIndex?: number }
        >,
        clonedSubflows: Array<{
          originalId: string
          clonedId: string
          outerBranchIndex: number
          parentParallelId: string
        }>
      ) => void
    }
    const parentMap = new Map<
      string,
      { parentId: string; parentType: 'loop' | 'parallel'; branchIndex?: number }
    >([['nested-loop', { parentId: 'parent-parallel', parentType: 'parallel' }]])

    executor.registerRestoredClonedSubflows(parentMap, [
      {
        originalId: 'nested-loop',
        clonedId: 'nested-loop__obranch-2',
        outerBranchIndex: 2,
        parentParallelId: 'parent-parallel',
      },
    ])

    expect(parentMap.get('nested-loop__obranch-2')).toEqual({
      parentId: 'parent-parallel',
      parentType: 'parallel',
      branchIndex: 2,
    })
  })

  it('preserves cloned nested parent relationships within the same restored branch', () => {
    const executor = createExecutor() as unknown as {
      registerRestoredClonedSubflows: (
        parentMap: Map<
          string,
          { parentId: string; parentType: 'loop' | 'parallel'; branchIndex?: number }
        >,
        clonedSubflows: Array<{
          originalId: string
          clonedId: string
          outerBranchIndex: number
          parentParallelId: string
        }>
      ) => void
    }
    const parentMap = new Map<
      string,
      { parentId: string; parentType: 'loop' | 'parallel'; branchIndex?: number }
    >([
      ['middle-loop', { parentId: 'parent-parallel', parentType: 'parallel' }],
      ['inner-parallel', { parentId: 'middle-loop', parentType: 'loop' }],
    ])

    executor.registerRestoredClonedSubflows(parentMap, [
      {
        originalId: 'middle-loop',
        clonedId: 'middle-loop__obranch-2',
        outerBranchIndex: 2,
        parentParallelId: 'parent-parallel',
      },
      {
        originalId: 'inner-parallel',
        clonedId: 'inner-parallel__obranch-2',
        outerBranchIndex: 2,
        parentParallelId: 'parent-parallel',
      },
    ])

    expect(parentMap.get('inner-parallel__obranch-2')).toEqual({
      parentId: 'middle-loop__obranch-2',
      parentType: 'loop',
      branchIndex: 0,
    })
  })
})
