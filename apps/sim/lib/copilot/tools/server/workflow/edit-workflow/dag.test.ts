import { describe, expect, it } from 'vitest'
import { computeWorkflowDag } from './dag'

function block(id: string, name: string, type = 'function') {
  return { id, type, name }
}

describe('computeWorkflowDag', () => {
  it('builds a linear adjacency with sinks as empty arrays', () => {
    const dag = computeWorkflowDag({
      blocks: { a: block('a', 'A', 'starter'), b: block('b', 'B'), c: block('c', 'C') },
      edges: [
        { source: 'a', target: 'b' },
        { source: 'b', target: 'c' },
      ],
    } as any)

    expect(dag).toEqual({ A: ['B'], B: ['C'], C: [] })
  })

  it('captures condition branches (if/else) as downstream names', () => {
    const dag = computeWorkflowDag({
      blocks: {
        cond: block('cond', 'Cond', 'condition'),
        x: block('x', 'X'),
        y: block('y', 'Y'),
      },
      edges: [
        { source: 'cond', sourceHandle: 'if', target: 'x' },
        { source: 'cond', sourceHandle: 'else', target: 'y' },
      ],
    } as any)

    expect(dag.Cond).toEqual(['X', 'Y'])
    expect(dag.X).toEqual([])
    expect(dag.Y).toEqual([])
  })

  it('captures router routes (sorted)', () => {
    const dag = computeWorkflowDag({
      blocks: {
        r: block('r', 'Router', 'router_v2'),
        s: block('s', 'Support'),
        sa: block('sa', 'Sales'),
      },
      edges: [
        { source: 'r', sourceHandle: 'route-0', target: 's' },
        { source: 'r', sourceHandle: 'route-1', target: 'sa' },
      ],
    } as any)

    expect(dag.Router).toEqual(['Sales', 'Support'])
  })

  it('captures subflow container edges (loop-start-source / loop-end-source)', () => {
    const dag = computeWorkflowDag({
      blocks: {
        loop: block('loop', 'Loop', 'loop'),
        child: block('child', 'Child'),
        after: block('after', 'After'),
      },
      edges: [
        { source: 'loop', sourceHandle: 'loop-start-source', target: 'child' },
        { source: 'loop', sourceHandle: 'loop-end-source', target: 'after' },
      ],
    } as any)

    expect(dag.Loop).toEqual(['After', 'Child'])
    expect(dag.Child).toEqual([])
    expect(dag.After).toEqual([])
  })

  it('excludes note blocks, dedups parallel edges, and ignores edges to missing blocks', () => {
    const dag = computeWorkflowDag({
      blocks: {
        a: block('a', 'A', 'starter'),
        x: block('x', 'X'),
        note: block('note', 'Note', 'note'),
      },
      edges: [
        { source: 'a', target: 'x' },
        { source: 'a', sourceHandle: 'error', target: 'x' }, // duplicate target
        { source: 'a', target: 'note' }, // note is excluded
        { source: 'a', target: 'ghost' }, // missing block
      ],
    } as any)

    expect(dag.A).toEqual(['X'])
    expect(dag.X).toEqual([])
    expect(dag.Note).toBeUndefined()
  })
})
