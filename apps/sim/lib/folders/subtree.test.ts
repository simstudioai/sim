/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { collectDescendantFolderIds, type FolderNode } from '@/lib/folders/subtree'

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
