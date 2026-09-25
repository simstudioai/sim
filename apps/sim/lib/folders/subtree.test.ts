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

  it('stops at maxDepth', () => {
    expect([...collectFolderDepths(depthTree, 'reports', { maxDepth: 1 }).keys()]).toEqual(['q3'])
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
  it('derives depth from the full tree, so a filtered row set cannot orphan descendants', () => {
    const rows = [{ id: 'draft' }]

    expect(selectFolderSubtreeRows(rows, depthTree, 'reports')).toEqual([{ id: 'draft' }])
  })
})
