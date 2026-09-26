/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { DbOrTx } from '@/lib/db/types'
import {
  collectForkLineageWorkspaceIds,
  type ForkLineageReader,
  MAX_FORK_LINEAGE_WORKSPACES,
  resolveForkSyncExclusionForNewWorkflow,
  walkToForkLineageRoot,
} from '@/ee/workspace-forking/lib/sync-default'

/** An in-memory lineage: workspace id -> the workspace it was forked from (null = a root). */
function reader(
  parents: Record<string, string | null>,
  archived: readonly string[] = []
): ForkLineageReader {
  return {
    getParentId: async (workspaceId) => parents[workspaceId] ?? null,
    // Deliberately does NOT filter archived children: the real reader must not either, or
    // an archived middle workspace blocks descent and splits the lineage. A fake that
    // filtered here would reproduce that bug and let the test pass.
    getChildIds: async (parentIds) =>
      Object.entries(parents)
        .filter(([, parentId]) => parentId !== null && parentIds.includes(parentId))
        .map(([id]) => id),
    liveAmong: async (ids) => ids.filter((id) => !archived.includes(id)),
  }
}

describe('walkToForkLineageRoot', () => {
  it('returns the workspace itself when it is not a fork', async () => {
    await expect(walkToForkLineageRoot(reader({ root: null }), 'root')).resolves.toBe('root')
  })

  it('climbs through intermediate forks to the original workspace', async () => {
    const parents = { root: null, mid: 'root', leaf: 'mid' }
    await expect(walkToForkLineageRoot(reader(parents), 'leaf')).resolves.toBe('root')
  })

  /** `forkedFromWorkspaceId` is ON DELETE SET NULL, and unlink clears it. */
  it('treats a severed chain as its own root rather than failing', async () => {
    await expect(walkToForkLineageRoot(reader({ unlinked: null }), 'unlinked')).resolves.toBe(
      'unlinked'
    )
  })

  /**
   * Absorbing a cycle would return a caller-dependent root (`a`->`b`, `b`->`a`), so two
   * callers would lock different keys for one lineage and lose mutual exclusion.
   */
  it('refuses a corrupted parent cycle rather than picking a caller-dependent root', async () => {
    const parents = { a: 'b', b: 'a' }
    await expect(walkToForkLineageRoot(reader(parents), 'a')).rejects.toThrow(/cycle/)
    await expect(walkToForkLineageRoot(reader(parents), 'b')).rejects.toThrow(/cycle/)
  })

  /** Archival preserves the parent link, so the root must not depend on who asks. */
  it('resolves the same root from either side of an archived intermediate', async () => {
    const parents = { root: null, mid: 'root', leaf: 'mid' }
    const r = reader(parents, ['mid'])
    await expect(walkToForkLineageRoot(r, 'leaf')).resolves.toBe('root')
    await expect(walkToForkLineageRoot(r, 'root')).resolves.toBe('root')
  })
})

describe('collectForkLineageWorkspaceIds', () => {
  const family = { root: null, forkA: 'root', forkB: 'root', grandchild: 'forkA' }

  it('reaches ancestors AND descendants when issued from a mid-lineage fork', async () => {
    const members = await collectForkLineageWorkspaceIds(reader(family), 'forkA')
    expect([...members].sort()).toEqual(['forkA', 'forkB', 'grandchild', 'root'])
  })

  it('returns the same set no matter which member it is issued from', async () => {
    const fromRoot = await collectForkLineageWorkspaceIds(reader(family), 'root')
    const fromLeaf = await collectForkLineageWorkspaceIds(reader(family), 'grandchild')
    expect([...fromRoot].sort()).toEqual([...fromLeaf].sort())
  })

  it('always includes the calling workspace, even when it is standalone', async () => {
    const members = await collectForkLineageWorkspaceIds(reader({ solo: null }), 'solo')
    expect(members).toEqual(['solo'])
  })

  it('propagates the cycle refusal rather than writing a partial lineage', async () => {
    await expect(collectForkLineageWorkspaceIds(reader({ a: 'b', b: 'a' }), 'a')).rejects.toThrow(
      /cycle/
    )
  })

  /**
   * An archived member is walked for topology so the root agrees from every side, but it is
   * never returned - a policy write must not touch a workspace the UI reports as gone.
   */
  it('traverses an archived member but excludes it from the writable set', async () => {
    const parents = { root: null, mid: 'root', leaf: 'mid' }
    const members = await collectForkLineageWorkspaceIds(reader(parents, ['mid']), 'leaf')
    expect([...members].sort()).toEqual(['leaf', 'root'])
  })

  /**
   * The regression that matters: archival is a soft delete, so a deleted template in the
   * middle must not stop the walk. If it does, every member computes a DIFFERENT write set
   * (`root -> [root]`, `leaf -> [leaf, root]`, `child -> [child, root]`) and the
   * "every member agrees" invariant breaks with no error.
   */
  it('reaches descendants BEYOND an archived member, from every member', async () => {
    const parents = { root: null, mid: 'root', leaf: 'mid', child: 'leaf' }
    const r = reader(parents, ['mid'])
    const expected = ['child', 'leaf', 'root']
    for (const from of ['root', 'leaf', 'child']) {
      expect([...(await collectForkLineageWorkspaceIds(r, from))].sort()).toEqual(expected)
    }
  })

  it('refuses a lineage larger than the cap rather than loading it', async () => {
    const parents: Record<string, string | null> = { root: null }
    for (let i = 0; i < MAX_FORK_LINEAGE_WORKSPACES + 10; i++) parents[`fork-${i}`] = 'root'
    await expect(collectForkLineageWorkspaceIds(reader(parents), 'root')).rejects.toThrow(
      /exceeds 500 workspaces/
    )
  })
})

/** Stands in for the single-row policy lookup the resolver issues. */
function policyExecutor(rows: Array<{ excluded: boolean }>): DbOrTx {
  const chain = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    limit: async () => rows,
  }
  return chain as unknown as DbOrTx
}

describe('resolveForkSyncExclusionForNewWorkflow', () => {
  /**
   * A personal, workspace-less workflow participates in no fork edge, so the policy must
   * never be what keeps it out - and the resolver must not issue a query for it either.
   */
  it.each([null, undefined, ''])('returns false for a workspace-less workflow (%p)', async (id) => {
    let queried = false
    const executor = {
      select: () => {
        queried = true
        return executor
      },
    } as unknown as DbOrTx
    await expect(resolveForkSyncExclusionForNewWorkflow(executor, id)).resolves.toBe(false)
    expect(queried).toBe(false)
  })

  it('returns the stored policy when the workspace opts in', async () => {
    await expect(
      resolveForkSyncExclusionForNewWorkflow(policyExecutor([{ excluded: true }]), 'ws-1')
    ).resolves.toBe(true)
  })

  it('returns false for the historical opt-out default', async () => {
    await expect(
      resolveForkSyncExclusionForNewWorkflow(policyExecutor([{ excluded: false }]), 'ws-1')
    ).resolves.toBe(false)
  })

  /**
   * Falling back to "included" is the safe direction: a workflow that should have been
   * excluded is visible in the Forks checkbox list and can be cleared, whereas one wrongly
   * excluded silently stops syncing.
   */
  it('falls back to included when the workspace row cannot be read', async () => {
    await expect(
      resolveForkSyncExclusionForNewWorkflow(policyExecutor([]), 'ws-deleted-mid-flight')
    ).resolves.toBe(false)
  })
})
