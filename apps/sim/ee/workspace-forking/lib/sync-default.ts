import { workspace } from '@sim/db/schema'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'
import { ForkError } from '@/ee/workspace-forking/lib/lineage/authz'

/**
 * Hard ceiling on how many workspaces one lineage traversal will visit. A fork lineage is a
 * template workspace plus its forks - tens at most in real use, so this is far above any
 * plausible shape while bounding a pathological or corrupted parent chain to a fixed number
 * of queries. Mirrors the bounded-load discipline of `MAX_FORK_DEPLOYED_WORKFLOWS` in
 * `copy/deploy-bridge.ts`.
 */
export const MAX_FORK_LINEAGE_WORKSPACES = 500

/**
 * The two reads a lineage traversal needs, injected so the walk itself is pure and testable
 * without a database. Both must return only LIVE (non-archived) workspaces.
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
   * while `L` and `C` each saw a different pair. {@link ForkLineageReader.liveAmong} is
   * what keeps archived members out of the writable set.
   */
  getChildIds(parentIds: string[]): Promise<string[]>
  /**
   * Which of `workspaceIds` are live. Archived members are traversed for topology but
   * never written. Batched deliberately: this runs inside the lineage-locked transaction,
   * where a per-member round trip would hold the lock for up to
   * {@link MAX_FORK_LINEAGE_WORKSPACES} queries.
   */
  liveAmong(workspaceIds: string[]): Promise<string[]>
}

export function createForkLineageReader(executor: DbOrTx): ForkLineageReader {
  return {
    async getParentId(workspaceId) {
      const [row] = await executor
        .select({ parentId: workspace.forkedFromWorkspaceId })
        .from(workspace)
        .where(eq(workspace.id, workspaceId))
        .limit(1)
      return row?.parentId ?? null
    },
    async liveAmong(workspaceIds) {
      if (workspaceIds.length === 0) return []
      const rows = await executor
        .select({ id: workspace.id })
        .from(workspace)
        .where(and(inArray(workspace.id, workspaceIds), isNull(workspace.archivedAt)))
      return rows.map((row) => row.id)
    },
    async getChildIds(parentIds) {
      const rows = await executor
        .select({ id: workspace.id })
        .from(workspace)
        .where(inArray(workspace.forkedFromWorkspaceId, parentIds))
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
 * Every live workspace in a fork lineage, resolved from ANY member: walk up to the root,
 * then expand descendants one level at a time.
 *
 * Batched breadth-first rather than a recursive CTE - lineages are shallow, so this costs a
 * handful of queries and stays unit-testable. The visited set dedupes, so a corrupted parent
 * cycle terminates instead of looping, and the member cap bounds the worst case.
 *
 * Includes `workspaceId` itself when it is live, so a caller writing the returned set never
 * silently skips the workspace it was asked about. An archived caller is walked for topology
 * but excluded from the result like any other archived member.
 */
export async function collectForkLineageWorkspaceIds(
  reader: ForkLineageReader,
  workspaceId: string
): Promise<string[]> {
  const rootId = await walkToForkLineageRoot(reader, workspaceId)
  // Seed with the root ALONE. Seeding the calling workspace too would mark it visited
  // before the walk reaches it, so it would be skipped as a frontier node and its own
  // descendants never expanded - `workspaceId` is added at the end instead.
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
  members.add(workspaceId)
  // Archived members are part of the topology - they must be walked so the root is the same
  // from every member - but they are never written. Returning them would let a policy write
  // touch workspaces the lineage UI reports as gone.
  const live = new Set(await reader.liveAmong([...members]))
  return [...members].filter((id) => live.has(id))
}

/** {@link walkToForkLineageRoot} against the database. */
export function resolveForkLineageRootId(executor: DbOrTx, workspaceId: string): Promise<string> {
  return walkToForkLineageRoot(createForkLineageReader(executor), workspaceId)
}

/** {@link collectForkLineageWorkspaceIds} against the database. */
export function resolveForkLineageWorkspaceIds(
  executor: DbOrTx,
  workspaceId: string
): Promise<string[]> {
  return collectForkLineageWorkspaceIds(createForkLineageReader(executor), workspaceId)
}

/**
 * Whether a workflow created right now in this workspace should start OUTSIDE fork sync,
 * read from the workspace's `forkSyncNewWorkflowsExcluded` policy.
 *
 * Returns `false` for a personal, workspace-less workflow: it participates in no fork edge
 * at all, so the flag must never be what keeps it out. Also `false` for a workspace that
 * cannot be read (archived or deleted mid-flight), which is the historical opt-out behaviour
 * and the safe direction - a workflow that should have been excluded is visible in the Forks
 * page's checkbox list and can be cleared, while one wrongly excluded silently stops syncing.
 */
export async function resolveForkSyncExclusionForNewWorkflow(
  executor: DbOrTx,
  workspaceId: string | null | undefined
): Promise<boolean> {
  if (!workspaceId) return false
  const [row] = await executor
    .select({ excluded: workspace.forkSyncNewWorkflowsExcluded })
    .from(workspace)
    // Archived workspaces fall through to the documented `false` default rather than
    // returning their stored policy: an archive racing a workflow insert must not mark the
    // new workflow excluded on the strength of a workspace that is already gone.
    .where(and(eq(workspace.id, workspaceId), isNull(workspace.archivedAt)))
    .limit(1)
  return row?.excluded ?? false
}
