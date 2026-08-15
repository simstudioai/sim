/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { ForkForestNode } from '@/lib/api/contracts/workspace-fork'
import {
  buildForkLineageRows,
  forkLineageRootId,
  forkLineageRoots,
} from '@/ee/workspace-forking/components/fork-lineage/lineage-rows'

const node = (id: string, parentId: string | null, name = id): ForkForestNode => ({
  id,
  name,
  color: '#33C482',
  logoUrl: null,
  organizationId: null,
  parentId,
  createdAt: '2026-01-01T00:00:00.000Z',
  viewerAccessible: true,
  viewerCanAdmin: true,
  deployedWorkflowCount: 0,
  edge: parentId ? { mapped: 0, unmapped: 0, lastSyncAt: null, undoableRun: null } : null,
})

/**
 * A chain and a branch in one forest, in the depth-first order the server emits:
 *
 *   root
 *   ├─ a
 *   │  └─ a1
 *   └─ b
 *   other
 */
const FOREST: ForkForestNode[] = [
  node('root', null),
  node('a', 'root'),
  node('a1', 'a'),
  node('b', 'root'),
  node('other', null),
]

describe('buildForkLineageRows', () => {
  it('gives a root no rails and every descendant one rail per level', () => {
    const rows = buildForkLineageRows(FOREST)
    const railsById = new Map(rows.map((row) => [row.node.id, row.rails]))

    expect(railsById.get('root')).toEqual([])
    expect(railsById.get('a')).toEqual(['branch'])
    expect(railsById.get('a1')).toEqual(['line', 'last-branch'])
    expect(railsById.get('b')).toEqual(['last-branch'])
  })

  it('keeps an ancestor rail running while that ancestor still has siblings below', () => {
    // `b` is drawn at `a`'s indent and comes after `a1`, so the level-0 line has to run THROUGH
    // `a1`'s row to reach it. Blanking it there would leave `b` hanging off nothing.
    const [, , a1] = buildForkLineageRows(FOREST)
    expect(a1.node.id).toBe('a1')
    expect(a1.rails[0]).toBe('line')
  })

  it('blanks an ancestor rail once that ancestor was its parent’s last child', () => {
    const forest = [node('root', null), node('a', 'root'), node('a1', 'a'), node('a2', 'a')]
    const railsById = new Map(buildForkLineageRows(forest).map((row) => [row.node.id, row.rails]))

    expect(railsById.get('a')).toEqual(['last-branch'])
    // Nothing follows `a` at root's child level, so its column is empty under it.
    expect(railsById.get('a1')).toEqual(['blank', 'branch'])
    expect(railsById.get('a2')).toEqual(['blank', 'last-branch'])
  })

  it('resolves each row to its parent so an edge action knows both sides', () => {
    const rows = buildForkLineageRows(FOREST)
    expect(rows.find((row) => row.node.id === 'a1')?.parent?.id).toBe('a')
    expect(rows.find((row) => row.node.id === 'root')?.parent).toBeNull()
  })

  it('keeps the ancestors of a match, so a filtered fork still reads as a fork', () => {
    const rows = buildForkLineageRows(FOREST, (candidate) => candidate.id === 'a1')
    expect(rows.map((row) => row.node.id)).toEqual(['root', 'a', 'a1'])
    // The retained ancestors are now the only children at their level, so the rails re-derive.
    expect(rows[1].rails).toEqual(['last-branch'])
  })

  it('returns nothing when no node matches', () => {
    expect(buildForkLineageRows(FOREST, () => false)).toEqual([])
  })
})

describe('forkLineageRootId', () => {
  it('walks up to the root of the workspace’s own lineage', () => {
    expect(forkLineageRootId(FOREST, 'a1')).toBe('root')
    expect(forkLineageRootId(FOREST, 'root')).toBe('root')
  })

  it('treats a workspace whose parent is outside the forest as its own root', () => {
    expect(forkLineageRootId([node('orphan', 'missing-parent')], 'orphan')).toBe('orphan')
  })

  it('returns null for a workspace the forest does not carry', () => {
    expect(forkLineageRootId(FOREST, 'nope')).toBeNull()
  })
})

describe('forkLineageRoots', () => {
  it('lists every root, including one whose parent is outside the forest', () => {
    const roots = forkLineageRoots([...FOREST, node('orphan', 'missing-parent')])
    expect(roots.map((root) => root.id)).toEqual(['root', 'other', 'orphan'])
  })
})
