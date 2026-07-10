import type { Edge } from 'reactflow'
import { describe, expect, it } from 'vitest'
import { validateEdges } from '@/stores/workflows/workflow/edge-validation'
import type { BlockState } from '@/stores/workflows/workflow/types'

function makeBlock(id: string, type: string, overrides?: Partial<BlockState>): BlockState {
  return {
    id,
    type,
    name: id,
    position: { x: 0, y: 0 },
    subBlocks: {},
    outputs: {},
    enabled: true,
    ...overrides,
  }
}

function makeEdge(id: string, source: string, target: string): Edge {
  return { id, source, target, type: 'default' }
}

describe('validateEdges', () => {
  it('accepts an edge between two root-scope blocks', () => {
    const blocks = {
      a: makeBlock('a', 'starter'),
      b: makeBlock('b', 'function'),
    }
    const result = validateEdges([makeEdge('e1', 'a', 'b')], blocks)
    expect(result.valid).toHaveLength(1)
    expect(result.dropped).toHaveLength(0)
  })

  it('drops an edge referencing a missing block', () => {
    const blocks = { a: makeBlock('a', 'starter') }
    const result = validateEdges([makeEdge('e1', 'a', 'missing')], blocks)
    expect(result.valid).toHaveLength(0)
    expect(result.dropped[0].reason).toBe('edge references a missing block')
  })

  it('drops an edge touching an annotation-only (note) block', () => {
    const blocks = {
      a: makeBlock('a', 'note'),
      b: makeBlock('b', 'function'),
    }
    const result = validateEdges([makeEdge('e1', 'a', 'b')], blocks)
    expect(result.valid).toHaveLength(0)
    expect(result.dropped[0].reason).toBe('edge references an annotation-only block')
  })

  it('drops an edge targeting a trigger block', () => {
    const blocks = {
      a: makeBlock('a', 'function'),
      b: makeBlock('b', 'function', { triggerMode: true }),
    }
    const result = validateEdges([makeEdge('e1', 'a', 'b')], blocks)
    expect(result.valid).toHaveLength(0)
    expect(result.dropped[0].reason).toBe('trigger blocks cannot be edge targets')
  })

  it('drops an edge crossing loop scope boundaries', () => {
    const blocks = {
      loop: makeBlock('loop', 'loop'),
      inner: makeBlock('inner', 'function', { data: { parentId: 'loop', extent: 'parent' } }),
      outer: makeBlock('outer', 'function'),
    }
    const result = validateEdges([makeEdge('e1', 'inner', 'outer')], blocks)
    expect(result.valid).toHaveLength(0)
    expect(result.dropped[0].reason).toContain('different scopes')
  })

  it('accepts an edge from a loop container into its own child', () => {
    const blocks = {
      loop: makeBlock('loop', 'loop'),
      inner: makeBlock('inner', 'function', { data: { parentId: 'loop', extent: 'parent' } }),
    }
    const result = validateEdges([makeEdge('e1', 'loop', 'inner')], blocks)
    expect(result.valid).toHaveLength(1)
  })

  it('accepts an edge from a loop child back out to its own container', () => {
    const blocks = {
      loop: makeBlock('loop', 'loop'),
      inner: makeBlock('inner', 'function', { data: { parentId: 'loop', extent: 'parent' } }),
    }
    const result = validateEdges([makeEdge('e1', 'inner', 'loop')], blocks)
    expect(result.valid).toHaveLength(1)
  })

  it('accepts edges between two siblings inside the same loop', () => {
    const blocks = {
      loop: makeBlock('loop', 'loop'),
      a: makeBlock('a', 'function', { data: { parentId: 'loop', extent: 'parent' } }),
      b: makeBlock('b', 'function', { data: { parentId: 'loop', extent: 'parent' } }),
    }
    const result = validateEdges([makeEdge('e1', 'a', 'b')], blocks)
    expect(result.valid).toHaveLength(1)
  })
})
