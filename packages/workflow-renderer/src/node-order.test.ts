/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { sortNodesParentsFirst } from './node-order'

const node = (id: string, parentId?: string) => (parentId ? { id, parentId } : { id })
const ids = (nodes: Array<{ id: string }>) => nodes.map((n) => n.id)

describe('sortNodesParentsFirst', () => {
  it('moves a child that precedes its container behind it', () => {
    /* The reported bug: a card created before the loop it was later dragged
       into sits ahead of the loop in row order, so React Flow v12 placed it at
       its loop-relative offset on every click. */
    const nodes = [node('start'), node('earlier'), node('sink', 'loop'), node('loop')]

    expect(ids(sortNodesParentsFirst(nodes))).toEqual(['start', 'earlier', 'loop', 'sink'])
  })

  it('returns the same array when every parent already precedes its children', () => {
    const nodes = [node('start'), node('loop'), node('sink', 'loop'), node('later')]

    expect(sortNodesParentsFirst(nodes)).toBe(nodes)
  })

  it('leaves a parents-first array alone even when depth drops between siblings', () => {
    const nodes = [node('loopA'), node('a1', 'loopA'), node('loopB'), node('b1', 'loopB')]

    expect(sortNodesParentsFirst(nodes)).toBe(nodes)
  })

  it('orders every level of a nested chain and keeps siblings in their original order', () => {
    const nodes = [
      node('grandchild', 'inner'),
      node('inner', 'outer'),
      node('second', 'outer'),
      node('first', 'outer'),
      node('outer'),
      node('top'),
    ]

    expect(ids(sortNodesParentsFirst(nodes))).toEqual([
      'outer',
      'top',
      'inner',
      'second',
      'first',
      'grandchild',
    ])
  })

  it('does not move a child whose parent is not in the array', () => {
    const nodes = [node('orphan', 'missing'), node('top')]

    expect(sortNodesParentsFirst(nodes)).toBe(nodes)
  })

  it('terminates on a parent cycle', () => {
    const nodes = [node('b', 'a'), node('a', 'b'), node('c', 'a')]

    expect(ids(sortNodesParentsFirst(nodes))).toHaveLength(3)
  })

  it('does not mutate its input when it has to reorder', () => {
    const nodes = [node('sink', 'loop'), node('loop')]
    const before = [...nodes]

    sortNodesParentsFirst(nodes)

    expect(nodes).toEqual(before)
  })
})
