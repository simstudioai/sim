import { workspace } from '@sim/db/schema'
import { eq, inArray } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'
import { ForkError } from '@/ee/workspace-forking/lib/lineage/authz'

/**
 * Hard ceiling on workspaces one lineage traversal visits: far above real lineages (tens at
 * most), while bounding a corrupted parent chain to a fixed number of queries.
 */
export const MAX_FORK_LINEAGE_WORKSPACES = 500

/**
 * The reads a lineage traversal needs, injected so the walk itself is pure and testable
 * without a database. Both include archived workspaces; writers filter liveness themselves.
 */
export interface ForkLineageReader {
  /**
   * The workspace a fork was created from, or null when it is not a fork.
   *
   * Resolves through ARCHIVED ancestors. Archival preserves `forkedFromWorkspaceId`, so
   * stopping at one would make the root depend on which member asked: for `R -> M -> L`
   * with `M` archived, `L` would report `M` as the root while `R` reported `R`, and the
   * two would take different advisory locks for the same lineage.
   */
  getParentId(workspaceId: string): Promise<string | null>
  /**
   * Workspaces forked directly from any of `parentIds`, ARCHIVED ONES INCLUDED.
   *
   * Archival is a soft delete that leaves children's `forkedFromWorkspaceId` intact, so
   * filtering archived members here would stop the walk at one and split a lineage into
   * disjoint sets per caller: for `R -> M(archived) -> L -> C`, `R` would see only itself
   * while `L` and `C` each saw a different pair.
   */
  getChildIds(parentIds: string[]): Promise<string[]>
}

function createForkLineageReader(executor: DbOrTx): ForkLineageReader {
  return {
    async getParentId(workspaceId) {
      const [row] = await executor
        .select({ parentId: workspace.forkedFromWorkspaceId })
        .from(workspace)
        .where(eq(workspace.id, workspaceId))
        .limit(1)
      return row?.parentId ?? null
    },
    async getChildIds(parentIds) {
      const rows = await executor
        .select({ id: workspace.id })
        .from(workspace)
        .where(inArray(workspace.forkedFromWorkspaceId, parentIds))
        // One past the cap, so an oversized lineage is refused without loading all of it.
        .limit(MAX_FORK_LINEAGE_WORKSPACES + 1)
      return rows.map((row) => row.id)
    },
  }
}

/**
 * The root of a fork lineage: the first ancestor that is not itself a fork.
 *
 * `forkedFromWorkspaceId` is ON DELETE SET NULL and an unlink clears it, so a severed chain
 * simply makes that workspace its own root.
 *
 * A cycle is corrupted data and is REFUSED rather than absorbed. Terminating on the visited
 * set would return a caller-dependent root - for `A -> B -> A`, `A` resolves to `B` while
 * `B` resolves to `A` - so two callers would take different advisory locks for the same
 * lineage and lose the mutual exclusion the lock exists to provide.
 */
export async function walkToForkLineageRoot(
  reader: ForkLineageReader,
  workspaceId: string
): Promise<string> {
  let currentId = workspaceId
  const seen = new Set<string>([currentId])
  for (let hop = 0; hop < MAX_FORK_LINEAGE_WORKSPACES; hop++) {
    const parentId = await reader.getParentId(currentId)
    if (!parentId) return currentId
    if (seen.has(parentId)) {
      throw new ForkError(
        `Fork lineage for workspace ${workspaceId} contains a cycle and cannot be resolved`,
        409
      )
    }
    seen.add(parentId)
    currentId = parentId
  }
  throw new ForkError('Fork lineage is too deep to resolve', 400)
}

/**
 * Every workspace in the fork lineage rooted at `rootId`, archived ones included, expanding
 * descendants one level at a time.
 *
 * Batched breadth-first rather than a recursive CTE - lineages are shallow, so this costs a
 * handful of queries and stays unit-testable. The visited set dedupes descendants and the
 * member cap bounds the worst case.
 */
export async function collectForkLineageWorkspaceIds(
  reader: ForkLineageReader,
  rootId: string
): Promise<string[]> {
  const members = new Set<string>([rootId])
  let frontier = [rootId]
  while (frontier.length > 0) {
    const next: string[] = []
    for (const childId of await reader.getChildIds(frontier)) {
      if (members.has(childId)) continue
      if (members.size >= MAX_FORK_LINEAGE_WORKSPACES) {
        throw new ForkError(`Fork lineage exceeds ${MAX_FORK_LINEAGE_WORKSPACES} workspaces`, 400)
      }
      members.add(childId)
      next.push(childId)
    }
    frontier = next
  }
  return [...members]
}

/** {@link walkToForkLineageRoot} against the database. */
export function resolveForkLineageRootId(executor: DbOrTx, workspaceId: string): Promise<string> {
  return walkToForkLineageRoot(createForkLineageReader(executor), workspaceId)
}

/** {@link collectForkLineageWorkspaceIds} against the database. */
export function resolveForkLineageWorkspaceIds(
  executor: DbOrTx,
  rootId: string
): Promise<string[]> {
  return collectForkLineageWorkspaceIds(createForkLineageReader(executor), rootId)
}
