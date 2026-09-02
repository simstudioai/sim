/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  collectDescendantFolderIds,
  collectDescendantFolderIdsFrom,
  collectFolderDepths,
  type FolderNode,
  indexFolderChildren,
  selectFolderSubtreeRows,
} from '@/lib/folders/subtree'

const tree: FolderNode[] = [
  { id: 'root', parentId: null },
  { id: 'a', parentId: 'root' },
  { id: 'b', parentId: 'root' },
  { id: 'a1', parentId: 'a' },
  { id: 'a2', parentId: 'a' },
  { id: 'a1x', parentId: 'a1' },
  { id: 'other', parentId: null },
]

describe('collectDescendantFolderIds', () => {
  it('collects the full subtree, excluding the root itself', () => {
    expect(collectDescendantFolderIds(tree, 'a').sort()).toEqual(['a1', 'a1x', 'a2'])
  })

  it('descends more than one level', () => {
    expect(collectDescendantFolderIds(tree, 'root')).toContain('a1x')
  })

  it('returns nothing for a leaf', () => {
    expect(collectDescendantFolderIds(tree, 'a1x')).toEqual([])
  })

  it('returns nothing for an unknown id', () => {
    expect(collectDescendantFolderIds(tree, 'missing')).toEqual([])
  })

  it('excludes unrelated branches', () => {
    expect(collectDescendantFolderIds(tree, 'a')).not.toContain('b')
    expect(collectDescendantFolderIds(tree, 'a')).not.toContain('other')
  })

  it('terminates on a parent cycle instead of recursing forever', () => {
    // The DB permits a transient cycle between constraint checks, so the walk must be
    // defensive rather than assume a well-formed tree.
    const cyclic: FolderNode[] = [
      { id: 'x', parentId: 'y' },
      { id: 'y', parentId: 'x' },
    ]

    expect(collectDescendantFolderIds(cyclic, 'x')).toEqual(['y'])
  })

  it('does not treat the start node as its own descendant when it is a child', () => {
    const selfParent: FolderNode[] = [{ id: 'x', parentId: 'x' }]

    expect(collectDescendantFolderIds(selfParent, 'x')).toEqual([])
  })

  it('handles an empty list', () => {
    expect(collectDescendantFolderIds([], 'x')).toEqual([])
  })
})

describe('collectDescendantFolderIdsFrom', () => {
  /**
   * The index-once path is what a bulk plan walks, so it must answer exactly
   * what the rebuild-per-call path answers — including for the cycle case.
   */
  it('matches the rebuild-per-call helper for every node in a tree', () => {
    const index = indexFolderChildren(tree)

    for (const node of [...tree, { id: 'missing', parentId: null }]) {
      expect(collectDescendantFolderIdsFrom(index, node.id).sort()).toEqual(
        collectDescendantFolderIds(tree, node.id).sort()
      )
    }
  })

  it('is reusable across folders without being rebuilt', () => {
    const index = indexFolderChildren(tree)

    expect(collectDescendantFolderIdsFrom(index, 'a').sort()).toEqual(['a1', 'a1x', 'a2'])
    expect(collectDescendantFolderIdsFrom(index, 'a').sort()).toEqual(['a1', 'a1x', 'a2'])
    expect(collectDescendantFolderIdsFrom(index, 'b')).toEqual([])
  })

  it('terminates on a parent cycle', () => {
    const cyclic: FolderNode[] = [
      { id: 'x', parentId: 'y' },
      { id: 'y', parentId: 'x' },
    ]

    expect(collectDescendantFolderIdsFrom(indexFolderChildren(cyclic), 'x')).toEqual(['y'])
  })
})

describe('indexFolderChildren', () => {
  it('keys children by parent and drops roots', () => {
    const index = indexFolderChildren(tree)

    expect(index.get('root')).toEqual(['a', 'b'])
    expect(index.get('a')).toEqual(['a1', 'a2'])
    expect(index.has('other')).toBe(false)
  })
})

const depthTree: FolderNode[] = [
  { id: 'reports', parentId: null },
  { id: 'q3', parentId: 'reports' },
  { id: 'draft', parentId: 'q3' },
  { id: 'reportsx', parentId: null },
]

describe('collectFolderDepths', () => {
  it('reports depth relative to the root, excluding the root itself', () => {
    const depths = collectFolderDepths(depthTree, 'reports')

    expect([...depths]).toEqual([
      ['q3', 1],
      ['draft', 2],
    ])
  })

  /*
   * The path-prefix bug this replaces: `/Reports` and `/Reportsx` share a
   * textual prefix but not a parent, so a parent walk cannot confuse them.
   */
  it('never treats a name-prefixed sibling as a descendant', () => {
    expect(collectFolderDepths(depthTree, 'reports').has('reportsx')).toBe(false)
  })

  it('walks from the workspace root when the root id is null', () => {
    const depths = collectFolderDepths(depthTree, null)

    expect(depths.get('reports')).toBe(1)
    expect(depths.get('reportsx')).toBe(1)
    expect(depths.get('draft')).toBe(3)
  })

  it('stops at maxDepth', () => {
    expect([...collectFolderDepths(depthTree, 'reports', { maxDepth: 1 }).keys()]).toEqual(['q3'])
  })

  it('returns nothing for a non-positive maxDepth', () => {
    expect(collectFolderDepths(depthTree, 'reports', { maxDepth: 0 }).size).toBe(0)
  })

  it('returns nothing for a root with no children', () => {
    expect(collectFolderDepths(depthTree, 'draft').size).toBe(0)
  })

  it('terminates on a cycle the database permits between constraint checks', () => {
    const cyclic: FolderNode[] = [
      { id: 'root', parentId: null },
      { id: 'a', parentId: 'root' },
      { id: 'b', parentId: 'a' },
      { id: 'a-again', parentId: 'b' },
    ]
    const withCycle: FolderNode[] = [...cyclic, { id: 'a', parentId: 'b' }]

    expect(() => collectFolderDepths(withCycle, 'root')).not.toThrow()
  })
})

describe('selectFolderSubtreeRows', () => {
  it('keeps the query order rather than the walk order', () => {
    const rows = [{ id: 'draft' }, { id: 'q3' }, { id: 'reportsx' }]

    expect(selectFolderSubtreeRows(rows, depthTree, 'reports')).toEqual([
      { id: 'draft' },
      { id: 'q3' },
    ])
  })

  it('derives depth from the full tree, so a filtered row set cannot orphan descendants', () => {
    const rows = [{ id: 'draft' }]

    expect(selectFolderSubtreeRows(rows, depthTree, 'reports')).toEqual([{ id: 'draft' }])
  })
})
