import { loggerMock } from '@sim/testing'
import { describe, expect, it, vi } from 'vitest'
import { InvalidFieldError } from '@/executor/utils/block-reference'
import { ParallelResolver } from './parallel'
import type { ResolutionContext } from './reference'

vi.mock('@sim/logger', () => loggerMock)

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
      distributionItems?: any
      parallelType?: 'count' | 'collection'
    }
  > = {}
) {
  // Ensure each parallel has required fields
  const normalizedParallels: Record<
    string,
    {
      id: string
      nodes: string[]
      distribution?: any
      distributionItems?: any
      parallelType?: 'count' | 'collection'
    }
  > = {}
  for (const [key, parallel] of Object.entries(parallels)) {
    normalizedParallels[key] = {
      id: parallel.id ?? key,
      nodes: parallel.nodes,
      distribution: parallel.distribution,
      distributionItems: parallel.distributionItems,
      parallelType: parallel.parallelType,
    }
  }
  return {
    version: '1.0',
    blocks: [],
    connections: [],
    loops: {},
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
    completedCount: 0,
    totalExpectedNodes: 1,
    items,
  }
}

/**
 * Creates a minimal ResolutionContext for testing.
 */
function createTestContext(
  currentNodeId: string,
  parallelExecutions?: Map<string, any>
): ResolutionContext {
  return {
    executionContext: {
      parallelExecutions: parallelExecutions ?? new Map(),
    },
    executionState: {},
    currentNodeId,
  } as ResolutionContext
}

describe('ParallelResolver', () => {
  describe('canResolve', () => {
    it.concurrent('should return true for bare parallel reference', () => {
      const resolver = new ParallelResolver(createTestWorkflow())
      expect(resolver.canResolve('<parallel>')).toBe(true)
    })

    it.concurrent('should return true for known parallel properties', () => {
      const resolver = new ParallelResolver(createTestWorkflow())
      expect(resolver.canResolve('<parallel.index>')).toBe(true)
      expect(resolver.canResolve('<parallel.currentItem>')).toBe(true)
      expect(resolver.canResolve('<parallel.items>')).toBe(true)
    })

    it.concurrent('should return true for parallel references with nested paths', () => {
      const resolver = new ParallelResolver(createTestWorkflow())
      expect(resolver.canResolve('<parallel.currentItem.name>')).toBe(true)
      expect(resolver.canResolve('<parallel.items.0>')).toBe(true)
    })

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

    it.concurrent('should return false for malformed references', () => {
      const resolver = new ParallelResolver(createTestWorkflow())
      expect(resolver.canResolve('parallel.index')).toBe(false)
      expect(resolver.canResolve('<parallel.index')).toBe(false)
      expect(resolver.canResolve('parallel.index>')).toBe(false)
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

    it.concurrent('should resolve different branch indices', () => {
      const workflow = createTestWorkflow({
        'parallel-1': { nodes: ['block-1'], distribution: ['a', 'b', 'c'] },
      })
      const resolver = new ParallelResolver(workflow)

      expect(resolver.resolve('<parallel.index>', createTestContext('block-1₍0₎'))).toBe(0)
      expect(resolver.resolve('<parallel.index>', createTestContext('block-1₍1₎'))).toBe(1)
      expect(resolver.resolve('<parallel.index>', createTestContext('block-1₍2₎'))).toBe(2)
    })

    it.concurrent('should return undefined when branch index cannot be extracted', () => {
      const workflow = createTestWorkflow({
        'parallel-1': { nodes: ['block-1'], distribution: ['a', 'b'] },
      })
      const resolver = new ParallelResolver(workflow)
      const ctx = createTestContext('block-1')

      expect(resolver.resolve('<parallel.index>', ctx)).toBeUndefined()
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

    it.concurrent('should resolve current item with nested path', () => {
      const workflow = createTestWorkflow({
        'parallel-1': {
          nodes: ['block-1'],
          distribution: [
            { name: 'Alice', age: 30 },
            { name: 'Bob', age: 25 },
          ],
        },
      })
      const resolver = new ParallelResolver(workflow)

      expect(resolver.resolve('<parallel.currentItem.name>', createTestContext('block-1₍0₎'))).toBe(
        'Alice'
      )
      expect(resolver.resolve('<parallel.currentItem.age>', createTestContext('block-1₍1₎'))).toBe(
        25
      )
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

  describe('resolve items property', () => {
    it.concurrent('should resolve all items from array distribution', () => {
      const workflow = createTestWorkflow({
        'parallel-1': { nodes: ['block-1'], distribution: [1, 2, 3] },
      })
      const resolver = new ParallelResolver(workflow)
      const ctx = createTestContext('block-1₍0₎')

      expect(resolver.resolve('<parallel.items>', ctx)).toEqual([1, 2, 3])
    })

    it.concurrent('should resolve items with nested path', () => {
      const workflow = createTestWorkflow({
        'parallel-1': {
          nodes: ['block-1'],
          distribution: [{ id: 1 }, { id: 2 }, { id: 3 }],
        },
      })
      const resolver = new ParallelResolver(workflow)
      const ctx = createTestContext('block-1₍0₎')

      expect(resolver.resolve('<parallel.items.1>', ctx)).toEqual({ id: 2 })
      expect(resolver.resolve('<parallel.items.1.id>', ctx)).toBe(2)
    })

    it.concurrent('should use runtime parallelScope items when available', () => {
      const workflow = createTestWorkflow({
        'parallel-1': { nodes: ['block-1'], distribution: ['static'] },
      })
      const resolver = new ParallelResolver(workflow)
      const parallelScope = createParallelScope(['runtime1', 'runtime2'])
      const parallelExecutions = new Map([['parallel-1', parallelScope]])
      const ctx = createTestContext('block-1₍0₎', parallelExecutions)

      expect(resolver.resolve('<parallel.items>', ctx)).toEqual(['runtime1', 'runtime2'])
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

    it.concurrent('should return minimal context object when no distribution', () => {
      const workflow = createTestWorkflow({
        'parallel-1': { nodes: ['block-1'] },
      })
      const resolver = new ParallelResolver(workflow)
      const ctx = createTestContext('block-1₍0₎')

      const result = resolver.resolve('<parallel>', ctx)
      expect(result).toHaveProperty('index', 0)
      expect(result).toHaveProperty('items')
    })

    it.concurrent('should throw InvalidFieldError for unknown parallel property', () => {
      const workflow = createTestWorkflow({
        'parallel-1': { nodes: ['block-1'], distribution: ['a'] },
      })
      const resolver = new ParallelResolver(workflow)
      const ctx = createTestContext('block-1₍0₎')

      expect(() => resolver.resolve('<parallel.unknownProperty>', ctx)).toThrow(InvalidFieldError)
    })

    it.concurrent('should return undefined when block is not in any parallel', () => {
      const workflow = createTestWorkflow({
        'parallel-1': { nodes: ['other-block'], distribution: ['a'] },
      })
      const resolver = new ParallelResolver(workflow)
      const ctx = createTestContext('block-1₍0₎')

      expect(resolver.resolve('<parallel.index>', ctx)).toBeUndefined()
    })

    it.concurrent('should return undefined when parallel config not found', () => {
      const workflow = createTestWorkflow({})
      const resolver = new ParallelResolver(workflow)
      const ctx = createTestContext('block-1₍0₎')

      expect(resolver.resolve('<parallel.index>', ctx)).toBeUndefined()
    })

    it.concurrent('should handle empty distribution array', () => {
      const workflow = createTestWorkflow({
        'parallel-1': { nodes: ['block-1'], distribution: [] },
      })
      const resolver = new ParallelResolver(workflow)
      const ctx = createTestContext('block-1₍0₎')

      expect(resolver.resolve('<parallel.items>', ctx)).toEqual([])
      expect(resolver.resolve('<parallel.currentItem>', ctx)).toBeUndefined()
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

    it.concurrent('should handle JSON string with single quotes', () => {
      const workflow = createTestWorkflow({
        'parallel-1': { nodes: ['block-1'], distribution: "['a', 'b']" },
      })
      const resolver = new ParallelResolver(workflow)
      const ctx = createTestContext('block-1₍0₎')

      expect(resolver.resolve('<parallel.items>', ctx)).toEqual(['a', 'b'])
    })

    it.concurrent('should return empty array for reference strings', () => {
      const workflow = createTestWorkflow({
        'parallel-1': { nodes: ['block-1'], distribution: '<block.output>' },
      })
      const resolver = new ParallelResolver(workflow)
      const ctx = createTestContext('block-1₍0₎')

      expect(resolver.resolve('<parallel.items>', ctx)).toEqual([])
    })

    it.concurrent('should handle distributionItems property as fallback', () => {
      const workflow = createTestWorkflow({
        'parallel-1': { nodes: ['block-1'], distributionItems: ['fallback1', 'fallback2'] },
      })
      const resolver = new ParallelResolver(workflow)
      const ctx = createTestContext('block-1₍0₎')

      expect(resolver.resolve('<parallel.items>', ctx)).toEqual(['fallback1', 'fallback2'])
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
})
