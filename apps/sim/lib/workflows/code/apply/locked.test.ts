/**
 * The locked-block gate must refuse every change the persistence door's
 * `preserveProtectedWorkflowBlocks` merge would silently undo, so that a write the gate admits is
 * stored exactly as submitted.
 */
import { omit } from '@sim/utils/object'
import { type BlockState, preserveProtectedWorkflowBlocks } from '@sim/workflow-types/workflow'
import { describe, expect, it } from 'vitest'
import { diffGraphs, type SourceGraph } from '@/lib/workflows/code/apply/graph-diff'
import {
  assertLockedBlocksPreserved,
  findLockedBlockRefusals,
} from '@/lib/workflows/code/apply/locked'

type GraphEdge = SourceGraph['edges'][number]

function block(
  id: string,
  options: { parentId?: string; locked?: boolean; type?: string } = {}
): BlockState {
  return {
    id,
    type: options.type ?? 'agent',
    name: id,
    position: { x: 10, y: 20 },
    subBlocks: { prompt: { id: 'prompt', type: 'long-input', value: `${id} prompt` } },
    outputs: {},
    enabled: true,
    ...(options.locked ? { locked: true } : {}),
    data: options.parentId ? { parentId: options.parentId, extent: 'parent' } : {},
  }
}

function edge(source: string, target: string, sourceHandle = 'source'): GraphEdge {
  return { id: `${source}->${target}`, source, target, sourceHandle, targetHandle: 'target' }
}

/** `loop` contains `child`; `a` and `b` sit beside it. */
function baseGraph(locked: ReadonlySet<string>): SourceGraph {
  return {
    blocks: {
      loop: block('loop', { type: 'loop', locked: locked.has('loop') }),
      child: block('child', { parentId: 'loop', locked: locked.has('child') }),
      a: block('a', { locked: locked.has('a') }),
      b: block('b', { locked: locked.has('b') }),
    },
    edges: [edge('a', 'b'), edge('b', 'loop'), edge('loop', 'child', 'loop-start-source')],
  }
}

/** Deletes blocks and every edge that touches them, as a deletion in source does. */
function removeBlocks(g: SourceGraph, ids: string[]): void {
  g.blocks = omit(g.blocks, ids)
  g.edges = g.edges.filter((e) => !ids.includes(e.source) && !ids.includes(e.target))
}

const MUTATIONS: Record<string, (g: SourceGraph) => void> = {
  'edit a field on a': (g) => {
    g.blocks.a.subBlocks.prompt.value = 'changed'
  },
  'edit a field on the child': (g) => {
    g.blocks.child.subBlocks.prompt.value = 'changed'
  },
  'rename b': (g) => {
    g.blocks.b.name = 'renamed'
  },
  'retype b': (g) => {
    g.blocks.b.type = 'function'
  },
  'disable b': (g) => {
    g.blocks.b.enabled = false
  },
  'delete a': (g) => removeBlocks(g, ['a']),
  'delete the child': (g) => removeBlocks(g, ['child']),
  'delete the loop with its child': (g) => removeBlocks(g, ['loop', 'child']),
  'add a top-level block wired into b': (g) => {
    g.blocks.n = block('n')
    g.edges.push(edge('n', 'b'))
  },
  'add a block inside the loop': (g) => {
    g.blocks.n = block('n', { parentId: 'loop' })
  },
  'move a into the loop': (g) => {
    g.blocks.a.data = { parentId: 'loop', extent: 'parent' }
  },
  'extract the child': (g) => {
    g.blocks.child.data = {}
  },
  'add an edge from a into the child': (g) => {
    g.edges.push(edge('a', 'child'))
  },
  'add an edge from b back to a': (g) => {
    g.edges.push(edge('b', 'a'))
  },
  'remove the edge a to b': (g) => {
    g.edges = g.edges.filter((e) => e.id !== 'a->b')
  },
  'remove the edge b to the loop': (g) => {
    g.edges = g.edges.filter((e) => e.id !== 'b->loop')
  },
  'lock a': (g) => {
    g.blocks.a.locked = true
  },
  'unlock a': (g) => {
    g.blocks.a.locked = false
  },
  'move the child on the canvas': (g) => {
    g.blocks.child.position = { x: 999, y: 999 }
  },
  'resize the loop': (g) => {
    g.blocks.loop.data = { ...g.blocks.loop.data, width: 800, height: 600 }
  },
}

const LOCKABLE = ['loop', 'child', 'a', 'b'] as const

function lockCombinations(): Set<string>[] {
  const combos: Set<string>[] = []
  for (let mask = 0; mask < 1 << LOCKABLE.length; mask++) {
    combos.push(new Set(LOCKABLE.filter((_, bit) => mask & (1 << bit))))
  }
  return combos
}

/** The persistence door restores stored positions before the merge; mirror that. */
function withStoredLayout(current: SourceGraph, target: SourceGraph): SourceGraph {
  const blocks = structuredClone(target.blocks)
  for (const [id, stored] of Object.entries(current.blocks)) {
    const next = blocks[id]
    if (!next) continue
    next.position = stored.position
    next.data = { ...omit(next.data ?? {}, ['width', 'height']) }
    if (stored.data?.width !== undefined) next.data.width = stored.data.width
    if (stored.data?.height !== undefined) next.data.height = stored.data.height
  }
  return { blocks, edges: target.edges }
}

const noKey = () => undefined

describe('findLockedBlockRefusals', () => {
  it('refuses every change the locked-block merge would undo, across every lock layout', () => {
    let admitted = 0
    let refused = 0
    for (const locked of lockCombinations()) {
      for (const [name, mutate] of Object.entries(MUTATIONS)) {
        const base = baseGraph(locked)
        const target = structuredClone(base)
        mutate(target)
        const refusals = findLockedBlockRefusals(base, target, diffGraphs(base, target), noKey)
        if (refusals.length > 0) {
          refused++
          continue
        }
        admitted++
        expect(
          () => assertLockedBlocksPreserved(base, withStoredLayout(base, target)),
          `${name} with locked=[${[...locked].join(',')}] was admitted but the merge changes it`
        ).not.toThrow()
      }
    }
    expect(admitted).toBeGreaterThan(0)
    expect(refused).toBeGreaterThan(0)
  })

  it('admits nothing the merge would change: the property is not vacuous', () => {
    const base = baseGraph(new Set(['b']))
    const target = structuredClone(base)
    target.blocks.b.name = 'renamed'
    const merged = preserveProtectedWorkflowBlocks(base, target)
    expect(merged.blocks.b.name).toBe('b')
    expect(
      findLockedBlockRefusals(base, target, diffGraphs(base, target), noKey).map((d) => d.blockId)
    ).toEqual(['b'])
  })

  it('refuses an edge added into a locked block, which the engine would let through', () => {
    const base = baseGraph(new Set(['b']))
    const target = structuredClone(base)
    target.blocks.n = block('n')
    target.edges.push(edge('n', 'b'))
    const refusals = findLockedBlockRefusals(base, target, diffGraphs(base, target), noKey)
    expect(refusals).toEqual([
      expect.objectContaining({ code: 'E_APPLY_LOCKED_BLOCK', blockId: 'b' }),
    ])
  })

  it('refuses rewiring the outgoing edges of a locked block', () => {
    const base = baseGraph(new Set(['a']))
    const target = structuredClone(base)
    target.edges = target.edges.filter((e) => e.id !== 'a->b')
    expect(
      findLockedBlockRefusals(base, target, diffGraphs(base, target), noKey).map((d) => d.blockId)
    ).toEqual(['a'])
  })

  it('lets an edge to a locked block go when its unlocked source is deleted', () => {
    const base = baseGraph(new Set(['b']))
    const target = structuredClone(base)
    removeBlocks(target, ['a'])
    expect(findLockedBlockRefusals(base, target, diffGraphs(base, target), noKey)).toEqual([])
  })

  it('refuses locking a block or creating one locked', () => {
    const base = baseGraph(new Set())
    const target = structuredClone(base)
    target.blocks.a.locked = true
    target.blocks.n = { ...block('n'), locked: true }
    expect(
      findLockedBlockRefusals(base, target, diffGraphs(base, target), noKey)
        .map((d) => d.blockId)
        .sort()
    ).toEqual(['a', 'n'])
  })

  it('refuses unlocking, even for a caller who could unlock on the canvas', () => {
    const base = baseGraph(new Set(['a']))
    const target = structuredClone(base)
    target.blocks.a.locked = false
    expect(findLockedBlockRefusals(base, target, diffGraphs(base, target), noKey)).toEqual([
      expect.objectContaining({ blockId: 'a', message: expect.stringContaining('lock') }),
    ])
  })

  it('names a locked container by its block name, not its id', () => {
    const base = baseGraph(new Set(['loop']))
    base.blocks.loop.name = 'Retry loop'
    const target = structuredClone(base)
    target.blocks.a.data = { parentId: 'loop', extent: 'parent' }
    target.blocks.n = block('n', { parentId: 'loop' })
    expect(
      findLockedBlockRefusals(base, target, diffGraphs(base, target), noKey).map((d) => d.message)
    ).toEqual([
      'Block "a" cannot be moved into locked container "Retry loop"',
      'Block "n" cannot be added to locked container "Retry loop"',
    ])
  })

  it('ignores a canvas move of a locked block', () => {
    const base = baseGraph(new Set(['loop']))
    const target = structuredClone(base)
    target.blocks.child.position = { x: 500, y: 500 }
    target.blocks.loop.data = { ...target.blocks.loop.data, width: 900 }
    expect(findLockedBlockRefusals(base, target, diffGraphs(base, target), noKey)).toEqual([])
  })
})

describe('assertLockedBlocksPreserved', () => {
  it('throws an internal error when the target changes a locked block', () => {
    const current = baseGraph(new Set(['a']))
    const target = structuredClone(current)
    target.blocks.a.subBlocks.prompt.value = 'changed'
    expect(() => assertLockedBlocksPreserved(current, target)).toThrow(
      expect.objectContaining({ code: 'internal' })
    )
  })

  it('throws when the target drops an edge into a locked block', () => {
    const current = baseGraph(new Set(['b']))
    const target = structuredClone(current)
    target.edges = target.edges.filter((e) => e.id !== 'a->b')
    expect(() => assertLockedBlocksPreserved(current, target)).toThrow()
  })

  it('accepts a target whose unlocked blocks omit the lock flag', () => {
    const current = baseGraph(new Set(['loop']))
    const target = structuredClone(current)
    target.blocks.a.subBlocks.prompt.value = 'changed'
    target.blocks.b = omit(target.blocks.b, ['locked'])
    expect(() => assertLockedBlocksPreserved(current, target)).not.toThrow()
  })
})
