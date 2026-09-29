/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  collectForkLineageWorkspaceIds,
  type ForkLineageReader,
  MAX_FORK_LINEAGE_WORKSPACES,
  walkToForkLineageRoot,
} from '@/ee/workspace-forking/lib/lineage/lineage-root'

/** An in-memory lineage: workspace id -> the workspace it was forked from (null = a root). */
function reader(parents: Record<string, string | null>): ForkLineageReader {
  return {
    getParentId: async (workspaceId) => parents[workspaceId] ?? null,
    getChildIds: async (parentIds) =>
      Object.entries(parents)
        .filter(([, parentId]) => parentId !== null && parentIds.includes(parentId))
        .map(([id]) => id),
  }
}

describe('walkToForkLineageRoot', () => {
  /**
   * Absorbing a cycle would return a caller-dependent root (`a`->`b`, `b`->`a`), so two
   * callers would lock different keys for one lineage and lose mutual exclusion.
   */
  it('refuses a corrupted parent cycle rather than picking a caller-dependent root', async () => {
    const parents = { a: 'b', b: 'a' }
    await expect(walkToForkLineageRoot(reader(parents), 'a')).rejects.toThrow(/cycle/)
    await expect(walkToForkLineageRoot(reader(parents), 'b')).rejects.toThrow(/cycle/)
  })
})

describe('collectForkLineageWorkspaceIds', () => {
  /**
   * Resolving root then members must give every member the same set, or two callers would
   * write different workspaces under the same lineage key.
   */
  it('returns the same full lineage from every member', async () => {
    const parents = { root: null, forkA: 'root', forkB: 'root', grandchild: 'forkA' }
    const r = reader(parents)
    for (const from of Object.keys(parents)) {
      const rootId = await walkToForkLineageRoot(r, from)
      expect([...(await collectForkLineageWorkspaceIds(r, rootId))].sort()).toEqual([
        'forkA',
        'forkB',
        'grandchild',
        'root',
      ])
    }
  })

  it('admits exactly the cap and refuses one member past it', async () => {
    const parents: Record<string, string | null> = { root: null }
    for (let i = 0; i < MAX_FORK_LINEAGE_WORKSPACES - 1; i++) parents[`fork-${i}`] = 'root'
    await expect(collectForkLineageWorkspaceIds(reader(parents), 'root')).resolves.toHaveLength(
      MAX_FORK_LINEAGE_WORKSPACES
    )
    parents.overflow = 'root'
    await expect(collectForkLineageWorkspaceIds(reader(parents), 'root')).rejects.toThrow(
      `exceeds ${MAX_FORK_LINEAGE_WORKSPACES} workspaces`
    )
  })
})
