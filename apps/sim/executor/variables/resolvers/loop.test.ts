import { describe, expect, it } from 'vitest'
import type { LoopScope } from '@/executor/execution/state'
import { InvalidFieldError } from '@/executor/utils/block-reference'
import { LoopResolver } from './loop'
import type { ResolutionContext } from './reference'

interface LoopDef {
  nodes: string[]
  id?: string
  iterations?: number
  loopType?: 'for' | 'forEach'
}

interface BlockDef {
  id: string
  name: string
}

function createTestWorkflow(loops: Record<string, LoopDef> = {}, blockDefs: BlockDef[] = []) {
  const normalizedLoops: Record<string, { id: string; nodes: string[]; iterations: number }> = {}
  for (const [key, loop] of Object.entries(loops)) {
    normalizedLoops[key] = {
      id: loop.id ?? key,
      nodes: loop.nodes,
      iterations: loop.iterations ?? 1,
      ...(loop.loopType && { loopType: loop.loopType }),
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
    loops: normalizedLoops,
    parallels: {},
  }
}

function createLoopScope(overrides: Partial<LoopScope> = {}): LoopScope {
  return {
    iteration: 0,
    currentIterationOutputs: new Map(),
    allIterationOutputs: [],
    ...overrides,
  }
}

function createTestContext(
  currentNodeId: string,
  loopScope?: LoopScope,
  loopExecutions?: Map<string, LoopScope>,
  blockOutputs?: Record<string, any>
): ResolutionContext {
  return {
    executionContext: {
      loopExecutions: loopExecutions ?? new Map(),
    },
    executionState: {
      getBlockOutput: (id: string) => blockOutputs?.[id],
    },
    currentNodeId,
    loopScope,
  } as ResolutionContext
}

describe('LoopResolver', () => {
  describe('canResolve', () => {
    it.concurrent('should return true for bare loop reference', () => {
      const resolver = new LoopResolver(createTestWorkflow())
      expect(resolver.canResolve('<loop>')).toBe(true)
    })

    it.concurrent('should return true for known loop properties', () => {
      const resolver = new LoopResolver(createTestWorkflow())
      expect(resolver.canResolve('<loop.index>')).toBe(true)
      expect(resolver.canResolve('<loop.iteration>')).toBe(true)
      expect(resolver.canResolve('<loop.item>')).toBe(true)
      expect(resolver.canResolve('<loop.currentItem>')).toBe(true)
      expect(resolver.canResolve('<loop.items>')).toBe(true)
    })

    it.concurrent('should return true for loop references with nested paths', () => {
      const resolver = new LoopResolver(createTestWorkflow())
      expect(resolver.canResolve('<loop.item.name>')).toBe(true)
      expect(resolver.canResolve('<loop.currentItem.data.value>')).toBe(true)
      expect(resolver.canResolve('<loop.items.0>')).toBe(true)
    })

    it.concurrent('should return true for unknown loop properties (validates in resolve)', () => {
      const resolver = new LoopResolver(createTestWorkflow())
      expect(resolver.canResolve('<loop.results>')).toBe(true)
      expect(resolver.canResolve('<loop.output>')).toBe(true)
      expect(resolver.canResolve('<loop.unknownProperty>')).toBe(true)
    })

    it.concurrent('should return false for non-loop references', () => {
      const resolver = new LoopResolver(createTestWorkflow())
      expect(resolver.canResolve('<block.output>')).toBe(false)
      expect(resolver.canResolve('<variable.myvar>')).toBe(false)
      expect(resolver.canResolve('<parallel.index>')).toBe(false)
      expect(resolver.canResolve('plain text')).toBe(false)
      expect(resolver.canResolve('{{ENV_VAR}}')).toBe(false)
    })

    it.concurrent('should return false for malformed references', () => {
      const resolver = new LoopResolver(createTestWorkflow())
      expect(resolver.canResolve('loop.index')).toBe(false)
      expect(resolver.canResolve('<loop.index')).toBe(false)
      expect(resolver.canResolve('loop.index>')).toBe(false)
    })
  })

  describe('resolve with explicit loopScope', () => {
    it.concurrent('should resolve iteration/index property', () => {
      const resolver = new LoopResolver(createTestWorkflow())
      const loopScope = createLoopScope({ iteration: 5 })
      const ctx = createTestContext('block-1', loopScope)

      expect(resolver.resolve('<loop.iteration>', ctx)).toBe(5)
      expect(resolver.resolve('<loop.index>', ctx)).toBe(5)
    })

    it.concurrent('should resolve item/currentItem property', () => {
      const resolver = new LoopResolver(createTestWorkflow())
      const loopScope = createLoopScope({ item: { name: 'test', value: 42 } })
      const ctx = createTestContext('block-1', loopScope)

      expect(resolver.resolve('<loop.item>', ctx)).toEqual({ name: 'test', value: 42 })
      expect(resolver.resolve('<loop.currentItem>', ctx)).toEqual({ name: 'test', value: 42 })
    })

    it.concurrent('should resolve items property', () => {
      const resolver = new LoopResolver(createTestWorkflow())
      const items = ['a', 'b', 'c']
      const loopScope = createLoopScope({ items })
      const ctx = createTestContext('block-1', loopScope)

      expect(resolver.resolve('<loop.items>', ctx)).toEqual(items)
    })

    it.concurrent('should resolve nested path in item', () => {
      const resolver = new LoopResolver(createTestWorkflow())
      const loopScope = createLoopScope({
        item: { user: { name: 'Alice', address: { city: 'NYC' } } },
      })
      const ctx = createTestContext('block-1', loopScope)

      expect(resolver.resolve('<loop.item.user.name>', ctx)).toBe('Alice')
      expect(resolver.resolve('<loop.item.user.address.city>', ctx)).toBe('NYC')
    })

    it.concurrent('should resolve array index in items', () => {
      const resolver = new LoopResolver(createTestWorkflow())
      const loopScope = createLoopScope({
        items: [{ id: 1 }, { id: 2 }, { id: 3 }],
      })
      const ctx = createTestContext('block-1', loopScope)

      expect(resolver.resolve('<loop.items.0>', ctx)).toEqual({ id: 1 })
      expect(resolver.resolve('<loop.items.1.id>', ctx)).toBe(2)
    })
  })

  describe('resolve without explicit loopScope (discovery)', () => {
    it.concurrent('should find loop scope from workflow config', () => {
      const workflow = createTestWorkflow({
        'loop-1': { nodes: ['block-1', 'block-2'] },
      })
      const resolver = new LoopResolver(workflow)
      const loopScope = createLoopScope({ iteration: 3 })
      const loopExecutions = new Map([['loop-1', loopScope]])
      const ctx = createTestContext('block-1', undefined, loopExecutions)

      expect(resolver.resolve('<loop.iteration>', ctx)).toBe(3)
    })

    it.concurrent('should return undefined when block is not in any loop', () => {
      const workflow = createTestWorkflow({
        'loop-1': { nodes: ['other-block'] },
      })
      const resolver = new LoopResolver(workflow)
      const ctx = createTestContext('block-1', undefined)

      expect(resolver.resolve('<loop.iteration>', ctx)).toBeUndefined()
    })

    it.concurrent('should return undefined when loop scope not found in executions', () => {
      const workflow = createTestWorkflow({
        'loop-1': { nodes: ['block-1'] },
      })
      const resolver = new LoopResolver(workflow)
      const ctx = createTestContext('block-1', undefined, new Map())

      expect(resolver.resolve('<loop.iteration>', ctx)).toBeUndefined()
    })
  })

  describe('edge cases', () => {
    it.concurrent('should return context object for bare loop reference', () => {
      const resolver = new LoopResolver(createTestWorkflow())
      const loopScope = createLoopScope({ iteration: 2, item: 'test', items: ['a', 'b', 'c'] })
      const ctx = createTestContext('block-1', loopScope)

      expect(resolver.resolve('<loop>', ctx)).toEqual({
        index: 2,
        currentItem: 'test',
        items: ['a', 'b', 'c'],
      })
    })

    it.concurrent('should return minimal context object for for-loop (no items)', () => {
      const resolver = new LoopResolver(createTestWorkflow())
      const loopScope = createLoopScope({ iteration: 5 })
      const ctx = createTestContext('block-1', loopScope)

      expect(resolver.resolve('<loop>', ctx)).toEqual({
        index: 5,
      })
    })

    it.concurrent('should throw InvalidFieldError for unknown loop property', () => {
      const resolver = new LoopResolver(createTestWorkflow())
      const loopScope = createLoopScope({ iteration: 0 })
      const ctx = createTestContext('block-1', loopScope)

      expect(() => resolver.resolve('<loop.unknownProperty>', ctx)).toThrow(InvalidFieldError)
    })

    it.concurrent('should handle iteration index 0 correctly', () => {
      const resolver = new LoopResolver(createTestWorkflow())
      const loopScope = createLoopScope({ iteration: 0 })
      const ctx = createTestContext('block-1', loopScope)

      expect(resolver.resolve('<loop.index>', ctx)).toBe(0)
    })

    it.concurrent('should handle null item value', () => {
      const resolver = new LoopResolver(createTestWorkflow())
      const loopScope = createLoopScope({ item: null })
      const ctx = createTestContext('block-1', loopScope)

      expect(resolver.resolve('<loop.item>', ctx)).toBeNull()
    })

    it.concurrent('should handle undefined item value', () => {
      const resolver = new LoopResolver(createTestWorkflow())
      const loopScope = createLoopScope({ item: undefined })
      const ctx = createTestContext('block-1', loopScope)

      expect(resolver.resolve('<loop.item>', ctx)).toBeUndefined()
    })

    it.concurrent('should handle empty items array', () => {
      const resolver = new LoopResolver(createTestWorkflow())
      const loopScope = createLoopScope({ items: [] })
      const ctx = createTestContext('block-1', loopScope)

      expect(resolver.resolve('<loop.items>', ctx)).toEqual([])
    })

    it.concurrent('should handle primitive item value', () => {
      const resolver = new LoopResolver(createTestWorkflow())
      const loopScope = createLoopScope({ item: 'simple string' })
      const ctx = createTestContext('block-1', loopScope)

      expect(resolver.resolve('<loop.item>', ctx)).toBe('simple string')
    })

    it.concurrent('should handle numeric item value', () => {
      const resolver = new LoopResolver(createTestWorkflow())
      const loopScope = createLoopScope({ item: 42 })
      const ctx = createTestContext('block-1', loopScope)

      expect(resolver.resolve('<loop.item>', ctx)).toBe(42)
    })

    it.concurrent('should handle boolean item value', () => {
      const resolver = new LoopResolver(createTestWorkflow())
      const loopScope = createLoopScope({ item: true })
      const ctx = createTestContext('block-1', loopScope)

      expect(resolver.resolve('<loop.item>', ctx)).toBe(true)
    })

    it.concurrent('should handle item with array value', () => {
      const resolver = new LoopResolver(createTestWorkflow())
      const loopScope = createLoopScope({ item: [1, 2, 3] })
      const ctx = createTestContext('block-1', loopScope)

      expect(resolver.resolve('<loop.item>', ctx)).toEqual([1, 2, 3])
      expect(resolver.resolve('<loop.item.0>', ctx)).toBe(1)
      expect(resolver.resolve('<loop.item.2>', ctx)).toBe(3)
    })
  })

  describe('block ID with branch suffix', () => {
    it.concurrent('should handle block ID with branch suffix in loop lookup', () => {
      const workflow = createTestWorkflow({
        'loop-1': { nodes: ['block-1'] },
      })
      const resolver = new LoopResolver(workflow)
      const loopScope = createLoopScope({ iteration: 2 })
      const loopExecutions = new Map([['loop-1', loopScope]])
      const ctx = createTestContext('block-1₍0₎', undefined, loopExecutions)

      expect(resolver.resolve('<loop.iteration>', ctx)).toBe(2)
    })
  })

  describe('named loop references', () => {
    it.concurrent('should resolve named loop by block name', () => {
      const workflow = createTestWorkflow({ 'loop-1': { nodes: ['block-1'] } }, [
        { id: 'loop-1', name: 'Loop 1' },
      ])
      const resolver = new LoopResolver(workflow)
      expect(resolver.canResolve('<loop1.index>')).toBe(true)
    })

    it.concurrent('should resolve index via named reference for block inside the loop', () => {
      const workflow = createTestWorkflow({ 'loop-1': { nodes: ['block-1'] } }, [
        { id: 'loop-1', name: 'Loop 1' },
      ])
      const resolver = new LoopResolver(workflow)
      const loopScope = createLoopScope({ iteration: 3 })
      const loopExecutions = new Map([['loop-1', loopScope]])
      const ctx = createTestContext('block-1', undefined, loopExecutions)

      expect(resolver.resolve('<loop1.index>', ctx)).toBe(3)
    })

    it.concurrent('should resolve index for block in a nested descendant loop', () => {
      const workflow = createTestWorkflow(
        {
          'loop-outer': { nodes: ['loop-inner', 'block-a'] },
          'loop-inner': { nodes: ['block-b'] },
        },
        [
          { id: 'loop-outer', name: 'Loop 1' },
          { id: 'loop-inner', name: 'Loop 2' },
        ]
      )
      const resolver = new LoopResolver(workflow)
      const outerScope = createLoopScope({ iteration: 2 })
      const innerScope = createLoopScope({ iteration: 4 })
      const loopExecutions = new Map<string, LoopScope>([
        ['loop-outer', outerScope],
        ['loop-inner', innerScope],
      ])
      const ctx = createTestContext('block-b', undefined, loopExecutions)

      expect(resolver.resolve('<loop1.index>', ctx)).toBe(2)
      expect(resolver.resolve('<loop2.index>', ctx)).toBe(4)
      expect(resolver.resolve('<loop.index>', ctx)).toBe(4)
    })

    it.concurrent('should return undefined for index when block is outside the loop', () => {
      const workflow = createTestWorkflow({ 'loop-1': { nodes: ['block-1'] } }, [
        { id: 'loop-1', name: 'Loop 1' },
      ])
      const resolver = new LoopResolver(workflow)
      const loopScope = createLoopScope({ iteration: 3 })
      const loopExecutions = new Map([['loop-1', loopScope]])
      const ctx = createTestContext('block-outside', undefined, loopExecutions)

      expect(resolver.resolve('<loop1.index>', ctx)).toBeUndefined()
    })

    it.concurrent('should resolve result from anywhere after loop completes', () => {
      const workflow = createTestWorkflow({ 'loop-1': { nodes: ['block-1'] } }, [
        { id: 'loop-1', name: 'Loop 1' },
      ])
      const resolver = new LoopResolver(workflow)
      const results = [[{ response: 'a' }], [{ response: 'b' }]]
      const ctx = createTestContext('block-outside', undefined, new Map(), {
        'loop-1': { results },
      })

      expect(resolver.resolve('<loop1.result>', ctx)).toEqual(results)
      expect(resolver.resolve('<loop1.results>', ctx)).toEqual(results)
    })

    it.concurrent('should resolve result with nested path', () => {
      const workflow = createTestWorkflow({ 'loop-1': { nodes: ['block-1'] } }, [
        { id: 'loop-1', name: 'Loop 1' },
      ])
      const resolver = new LoopResolver(workflow)
      const results = [[{ response: 'a' }], [{ response: 'b' }]]
      const ctx = createTestContext('block-outside', undefined, new Map(), {
        'loop-1': { results },
      })

      expect(resolver.resolve('<loop1.result.0>', ctx)).toEqual([{ response: 'a' }])
      expect(resolver.resolve('<loop1.result.1.0.response>', ctx)).toBe('b')
    })

    it.concurrent('should resolve forEach properties via named reference', () => {
      const workflow = createTestWorkflow(
        { 'loop-1': { nodes: ['block-1'], loopType: 'forEach' } },
        [{ id: 'loop-1', name: 'Loop 1' }]
      )
      const resolver = new LoopResolver(workflow)
      const items = ['x', 'y', 'z']
      const loopScope = createLoopScope({ iteration: 1, item: 'y', items })
      const loopExecutions = new Map([['loop-1', loopScope]])
      const ctx = createTestContext('block-1', undefined, loopExecutions)

      expect(resolver.resolve('<loop1.index>', ctx)).toBe(1)
      expect(resolver.resolve('<loop1.currentItem>', ctx)).toBe('y')
      expect(resolver.resolve('<loop1.items>', ctx)).toEqual(items)
    })

    it.concurrent('should throw InvalidFieldError for unknown property on named ref', () => {
      const workflow = createTestWorkflow({ 'loop-1': { nodes: ['block-1'] } }, [
        { id: 'loop-1', name: 'Loop 1' },
      ])
      const resolver = new LoopResolver(workflow)
      const loopScope = createLoopScope({ iteration: 0 })
      const loopExecutions = new Map([['loop-1', loopScope]])
      const ctx = createTestContext('block-1', undefined, loopExecutions)

      expect(() => resolver.resolve('<loop1.unknownProp>', ctx)).toThrow(InvalidFieldError)
    })

    it.concurrent('should not resolve named ref when no matching block exists', () => {
      const workflow = createTestWorkflow({ 'loop-1': { nodes: ['block-1'] } }, [
        { id: 'loop-1', name: 'Loop 1' },
      ])
      const resolver = new LoopResolver(workflow)
      expect(resolver.canResolve('<loop99.index>')).toBe(false)
    })
  })
})
