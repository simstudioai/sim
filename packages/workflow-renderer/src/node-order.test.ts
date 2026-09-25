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

  it('terminates on a parent cycle', () => {
    const nodes = [node('b', 'a'), node('a', 'b'), node('c', 'a')]

    expect(ids(sortNodesParentsFirst(nodes))).toHaveLength(3)
  })
})
