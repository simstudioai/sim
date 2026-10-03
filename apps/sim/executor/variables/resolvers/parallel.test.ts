import { describe, expect, it } from 'vitest'
import { compactExecutionPayload } from '@/lib/execution/payloads/serializer'
import { InvalidFieldError } from '@/executor/utils/block-reference'
import { ParallelResolver } from './parallel'
import type { ResolutionContext } from './reference'

interface BlockDef {
  id: string
  name: string
}

/**
 * Creates a minimal workflow for testing.
 */
function createTestWorkflow(
  parallels: Record<
    string,
    {
      nodes: string[]
      id?: string
      distribution?: any
      parallelType?: 'count' | 'collection'
    }
  > = {},
  blockDefs: BlockDef[] = [],
  loops: Record<string, { id?: string; nodes: string[] }> = {}
) {
  const normalizedParallels: Record<
    string,
    {
      id: string
      nodes: string[]
      distribution?: any
      parallelType?: 'count' | 'collection'
    }
  > = {}
  for (const [key, parallel] of Object.entries(parallels)) {
    normalizedParallels[key] = {
      id: parallel.id ?? key,
      nodes: parallel.nodes,
      distribution: parallel.distribution,
      parallelType: parallel.parallelType,
    }
  }
  const blocks = blockDefs.map((b) => ({
    id: b.id,
    position: { x: 0, y: 0 },
    config: { tool: 'test', params: {} },
    inputs: {},
    outputs: {},
    metadata: { id: 'function', name: b.name },
    enabled: true,
  }))
  return {
    version: '1.0',
    blocks,
    connections: [],
    loops,
    parallels: normalizedParallels,
  }
}

/**
 * Creates a parallel scope for runtime context.
 */
function createParallelScope(items: any[]) {
  return {
    parallelId: 'parallel-1',
    totalBranches: items.length,
    branchOutputs: new Map(),
    items,
  }
}

/**
 * Creates a minimal ResolutionContext for testing.
 */
function createTestContext(
  currentNodeId: string,
  parallelExecutions?: Map<string, any>,
  blockOutputs?: Record<string, any>,
  parallelBlockMapping?: Map<string, any>,
  subflowParentMap?: Map<string, any>
): ResolutionContext {
  return {
    executionContext: {
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      executionId: 'execution-1',
      parallelExecutions: parallelExecutions ?? new Map(),
      parallelBlockMapping,
      subflowParentMap,
    },
    executionState: {
      getBlockOutput: (id: string) => blockOutputs?.[id],
    },
    currentNodeId,
  } as ResolutionContext
}

describe('ParallelResolver', () => {
  describe('canResolve', () => {
    it.concurrent(
      'should return true for unknown parallel properties (validates in resolve)',
      () => {
        const resolver = new ParallelResolver(createTestWorkflow())
        expect(resolver.canResolve('<parallel.results>')).toBe(true)
        expect(resolver.canResolve('<parallel.output>')).toBe(true)
        expect(resolver.canResolve('<parallel.unknownProperty>')).toBe(true)
      }
    )

    it.concurrent('should return false for non-parallel references', () => {
      const resolver = new ParallelResolver(createTestWorkflow())
      expect(resolver.canResolve('<block.output>')).toBe(false)
      expect(resolver.canResolve('<variable.myvar>')).toBe(false)
      expect(resolver.canResolve('<loop.index>')).toBe(false)
      expect(resolver.canResolve('plain text')).toBe(false)
      expect(resolver.canResolve('{{ENV_VAR}}')).toBe(false)
    })
  })

  describe('resolve index property', () => {
    it.concurrent('should resolve branch index from node ID', () => {
      const workflow = createTestWorkflow({
        'parallel-1': { nodes: ['block-1'], distribution: ['a', 'b', 'c'] },
      })
      const resolver = new ParallelResolver(workflow)
      const ctx = createTestContext('block-1₍0₎')

      expect(resolver.resolve('<parallel.index>', ctx)).toBe(0)
    })

    it.concurrent('uses runtime branch mapping for batched local branch node IDs', () => {
      const workflow = createTestWorkflow({
        'parallel-1': { nodes: ['block-1'], distribution: ['a', 'b', 'c', 'd'] },
      })
      const resolver = new ParallelResolver(workflow)
      const parallelScope = createParallelScope(['a', 'b', 'c', 'd'])
      const parallelExecutions = new Map([['parallel-1', parallelScope]])
      const parallelBlockMapping = new Map([
        [
          'block-1₍0₎',
          {
            originalBlockId: 'block-1',
            parallelId: 'parallel-1',
            iterationIndex: 2,
          },
        ],
      ])
      const ctx = createTestContext(
        'block-1₍0₎',
        parallelExecutions,
        undefined,
        parallelBlockMapping
      )

      expect(resolver.resolve('<parallel.index>', ctx)).toBe(2)
      expect(resolver.resolve('<parallel.currentItem>', ctx)).toBe('c')
    })
  })

  describe('resolve currentItem property', () => {
    it.concurrent('should resolve current item from array distribution', () => {
      const workflow = createTestWorkflow({
        'parallel-1': { nodes: ['block-1'], distribution: ['apple', 'banana', 'cherry'] },
      })
      const resolver = new ParallelResolver(workflow)

      expect(resolver.resolve('<parallel.currentItem>', createTestContext('block-1₍0₎'))).toBe(
        'apple'
      )
      expect(resolver.resolve('<parallel.currentItem>', createTestContext('block-1₍1₎'))).toBe(
        'banana'
      )
      expect(resolver.resolve('<parallel.currentItem>', createTestContext('block-1₍2₎'))).toBe(
        'cherry'
      )
    })

    it.concurrent('should resolve current item from object distribution as entries', () => {
      // When an object is used as distribution, it gets converted to entries [key, value]
      const workflow = createTestWorkflow({
        'parallel-1': {
          nodes: ['block-1'],
          distribution: { key1: 'value1', key2: 'value2' },
        },
      })
      const resolver = new ParallelResolver(workflow)
      const ctx0 = createTestContext('block-1₍0₎')
      const ctx1 = createTestContext('block-1₍1₎')

      const item0 = resolver.resolve('<parallel.currentItem>', ctx0)
      const item1 = resolver.resolve('<parallel.currentItem>', ctx1)

      // Object entries are returned as [key, value] tuples
      expect(item0).toEqual(['key1', 'value1'])
      expect(item1).toEqual(['key2', 'value2'])
    })

    it.concurrent('should use runtime parallelScope items when available', () => {
      const workflow = createTestWorkflow({
        'parallel-1': { nodes: ['block-1'], distribution: ['static1', 'static2'] },
      })
      const resolver = new ParallelResolver(workflow)
      const parallelScope = createParallelScope(['runtime1', 'runtime2', 'runtime3'])
      const parallelExecutions = new Map([['parallel-1', parallelScope]])
      const ctx = createTestContext('block-1₍1₎', parallelExecutions)

      expect(resolver.resolve('<parallel.currentItem>', ctx)).toBe('runtime2')
    })
  })

  describe('edge cases', () => {
    it.concurrent('should return context object for bare parallel reference', () => {
      const workflow = createTestWorkflow({
        'parallel-1': { nodes: ['block-1'], distribution: ['a', 'b', 'c'] },
      })
      const resolver = new ParallelResolver(workflow)
      const ctx = createTestContext('block-1₍1₎')

      expect(resolver.resolve('<parallel>', ctx)).toEqual({
        index: 1,
        currentItem: 'b',
        items: ['a', 'b', 'c'],
      })
    })

    it.concurrent('should throw InvalidFieldError for unknown parallel property', () => {
      const workflow = createTestWorkflow({
        'parallel-1': { nodes: ['block-1'], distribution: ['a'] },
      })
      const resolver = new ParallelResolver(workflow)
      const ctx = createTestContext('block-1₍0₎')

      expect(() => resolver.resolve('<parallel.unknownProperty>', ctx)).toThrow(InvalidFieldError)
      expect(() => resolver.resolve('<parallel.unknownProperty>', ctx)).toThrow(
        'Available fields: index'
      )
    })

    it.concurrent('should return undefined when block is not in any parallel', () => {
      const workflow = createTestWorkflow({
        'parallel-1': { nodes: ['other-block'], distribution: ['a'] },
      })
      const resolver = new ParallelResolver(workflow)
      const ctx = createTestContext('block-1₍0₎')

      expect(resolver.resolve('<parallel.index>', ctx)).toBeUndefined()
    })

    it.concurrent('should handle JSON string distribution', () => {
      const workflow = createTestWorkflow({
        'parallel-1': { nodes: ['block-1'], distribution: '["x", "y", "z"]' },
      })
      const resolver = new ParallelResolver(workflow)
      const ctx = createTestContext('block-1₍1₎')

      expect(resolver.resolve('<parallel.items>', ctx)).toEqual(['x', 'y', 'z'])
      expect(resolver.resolve('<parallel.currentItem>', ctx)).toBe('y')
    })
  })

  describe('nested parallel blocks', () => {
    it.concurrent('should resolve for block with multiple parallel parents', () => {
      const workflow = createTestWorkflow({
        'parallel-1': { nodes: ['block-1', 'block-2'], distribution: ['p1', 'p2'] },
        'parallel-2': { nodes: ['block-3'], distribution: ['p3', 'p4'] },
      })
      const resolver = new ParallelResolver(workflow)

      expect(resolver.resolve('<parallel.currentItem>', createTestContext('block-1₍0₎'))).toBe('p1')
      expect(resolver.resolve('<parallel.currentItem>', createTestContext('block-3₍1₎'))).toBe('p4')
    })
  })

  describe('named parallel references', () => {
    it.concurrent('should resolve result from anywhere after parallel completes', () => {
      const workflow = createTestWorkflow(
        { 'parallel-1': { nodes: ['block-1'], distribution: ['a', 'b'] } },
        [{ id: 'parallel-1', name: 'Parallel 1' }]
      )
      const resolver = new ParallelResolver(workflow)
      const results = [[{ response: 'a' }], [{ response: 'b' }]]
      const ctx = createTestContext('block-outside', new Map(), {
        'parallel-1': { results },
      })

      expect(resolver.resolve('<parallel1.result>', ctx)).toEqual(results)
      expect(resolver.resolve('<parallel1.results>', ctx)).toEqual(results)
    })

    it('should resolve nested paths inside compacted result references', async () => {
      const workflow = createTestWorkflow(
        { 'parallel-1': { nodes: ['block-1'], distribution: ['a', 'b'] } },
        [{ id: 'parallel-1', name: 'Parallel 1' }]
      )
      const resolver = new ParallelResolver(workflow)
      const compacted = await compactExecutionPayload(
        { results: [[{ response: 'a' }], [{ response: 'b', payload: 'x'.repeat(2048) }]] },
        {
          thresholdBytes: 256,
          workspaceId: 'workspace-1',
          workflowId: 'workflow-1',
          executionId: 'execution-1',
        }
      )
      const ctx = createTestContext('block-outside', new Map(), {
        'parallel-1': compacted,
      })

      expect(resolver.resolve('<parallel1.result.1.0.response>', ctx)).toBe('b')
      expect(resolver.resolve('<parallel1.results[1][0].response>', ctx)).toBe('b')
      expect(() => resolver.resolve('<parallel1.results>', ctx)).toThrow('too large to inline')
    })

    it.concurrent('should resolve iteration properties via named reference', () => {
      const workflow = createTestWorkflow(
        {
          'parallel-1': {
            nodes: ['block-1'],
            distribution: ['x', 'y', 'z'],
            parallelType: 'collection',
          },
        },
        [{ id: 'parallel-1', name: 'Parallel 1' }]
      )
      const resolver = new ParallelResolver(workflow)
      const ctx = createTestContext('block-1₍1₎')

      expect(resolver.resolve('<parallel1.index>', ctx)).toBe(1)
      expect(resolver.resolve('<parallel1.currentItem>', ctx)).toBe('y')
      expect(resolver.resolve('<parallel1.items>', ctx)).toEqual(['x', 'y', 'z'])
    })

    it.concurrent('should list only results for contextual fields outside a named parallel', () => {
      const workflow = createTestWorkflow(
        {
          'parallel-1': {
            nodes: ['block-1'],
            distribution: ['a'],
            parallelType: 'collection',
          },
        },
        [{ id: 'parallel-1', name: 'Parallel 1' }]
      )
      const resolver = new ParallelResolver(workflow)
      const ctx = createTestContext('block-outside', new Map())

      expect(() => resolver.resolve('<parallel1.index>', ctx)).toThrow(InvalidFieldError)
      expect(() => resolver.resolve('<parallel1.index>', ctx)).toThrow('Available fields: results')
      expect(() => resolver.resolve('<parallel1.cooked>', ctx)).toThrow(InvalidFieldError)
      expect(() => resolver.resolve('<parallel1.cooked>', ctx)).toThrow('Available fields: results')
    })

    it('resolves generic parallel context from inside a loop nested in a parallel', () => {
      const workflow = createTestWorkflow(
        {
          'parallel-1': {
            nodes: ['loop-1'],
            distribution: ['a', 'b', 'c'],
            parallelType: 'collection',
          },
        },
        [],
        { 'loop-1': { id: 'loop-1', nodes: ['block-1'] } }
      )
      const resolver = new ParallelResolver(workflow)
      const ctx = createTestContext(
        'block-1__cloneaaa__obranch-2',
        new Map([['parallel-1', createParallelScope(['a', 'b', 'c'])]])
      )

      expect(resolver.resolve('<parallel.index>', ctx)).toBe(2)
      expect(resolver.resolve('<parallel.currentItem>', ctx)).toBe('c')
    })

    it('resolves inner parallel branch context independently from the outer clone index', () => {
      const workflow = createTestWorkflow({
        'outer-parallel': {
          nodes: ['inner-parallel'],
          distribution: ['outer0', 'outer1', 'outer2'],
        },
        'inner-parallel': {
          nodes: ['block-1'],
          distribution: ['inner0', 'inner1'],
        },
      })
      const resolver = new ParallelResolver(workflow)
      const parallelExecutions = new Map([
        ['inner-parallel__obranch-2', createParallelScope(['inner0', 'inner1'])],
      ])
      const ctx = createTestContext('block-1__cloneabc__obranch-2₍1₎', parallelExecutions)

      expect(resolver.resolve('<parallel.index>', ctx)).toBe(1)
      expect(resolver.resolve('<parallel.currentItem>', ctx)).toBe('inner1')
    })

    it('resolves parent parallel context for branch-zero nested subflow descendants', () => {
      const workflow = createTestWorkflow(
        {
          'outer-parallel': {
            nodes: ['inner-loop'],
            distribution: ['outer0', 'outer1'],
          },
        },
        [],
        { 'inner-loop': { id: 'inner-loop', nodes: ['loop-task'] } }
      )
      const resolver = new ParallelResolver(workflow)
      const parallelExecutions = new Map([
        ['outer-parallel', createParallelScope(['outer0', 'outer1'])],
      ])
      const ctx = createTestContext(
        'loop-task',
        parallelExecutions,
        undefined,
        undefined,
        new Map([
          ['inner-loop', { parentId: 'outer-parallel', parentType: 'parallel', branchIndex: 0 }],
        ])
      )

      expect(resolver.resolve('<parallel.index>', ctx)).toBe(0)
      expect(resolver.resolve('<parallel.currentItem>', ctx)).toBe('outer0')
    })
  })
})
