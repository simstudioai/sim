import { workspaceForkBlockMap } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'
import type { ForkBlockMap } from '@/lib/workspaces/fork/remap/block-identity'

/** One persisted block-identity pair for an edge (carries both workflow sides). */
export interface ForkBlockPair {
  parentWorkflowId: string
  parentBlockId: string
  childWorkflowId: string
  childBlockId: string
}

/**
 * Load an edge's persisted block-identity pairs into both lookup directions, each entry
 * carrying its target-side workflow so the resolver can scope a reuse to the right workflow
 * (see {@link buildForkBlockIdResolver}). Blocks without a pair (added since the last sync)
 * fall back to the deterministic derive.
 */
export async function loadForkBlockMap(
  executor: DbOrTx,
  childWorkspaceId: string
): Promise<ForkBlockMap> {
  const rows = await executor
    .select({
      parentWorkflowId: workspaceForkBlockMap.parentWorkflowId,
      parentBlockId: workspaceForkBlockMap.parentBlockId,
      childWorkflowId: workspaceForkBlockMap.childWorkflowId,
      childBlockId: workspaceForkBlockMap.childBlockId,
    })
    .from(workspaceForkBlockMap)
    .where(eq(workspaceForkBlockMap.childWorkspaceId, childWorkspaceId))
  const parentToChild = new Map<string, { targetBlockId: string; targetWorkflowId: string }>()
  const childToParent = new Map<string, { targetBlockId: string; targetWorkflowId: string }>()
  for (const row of rows) {
    parentToChild.set(row.parentBlockId, {
      targetBlockId: row.childBlockId,
      targetWorkflowId: row.childWorkflowId,
    })
    childToParent.set(row.childBlockId, {
      targetBlockId: row.parentBlockId,
      targetWorkflowId: row.parentWorkflowId,
    })
  }
  return { parentToChild, childToParent }
}

/**
 * Orient one workflow's copy mapping (`sourceBlockId -> targetBlockId`) into block pairs.
 * On pull/create the source is the parent; on push it's the child. The workflow ids are
 * fixed for the whole mapping (one source workflow copied into one target workflow).
 */
export function toForkBlockPairs(
  blockIdMapping: ReadonlyMap<string, string>,
  sourceIsParent: boolean,
  sourceWorkflowId: string,
  targetWorkflowId: string
): ForkBlockPair[] {
  const parentWorkflowId = sourceIsParent ? sourceWorkflowId : targetWorkflowId
  const childWorkflowId = sourceIsParent ? targetWorkflowId : sourceWorkflowId
  const pairs: ForkBlockPair[] = []
  for (const [sourceBlockId, targetBlockId] of blockIdMapping) {
    pairs.push({
      parentWorkflowId,
      childWorkflowId,
      parentBlockId: sourceIsParent ? sourceBlockId : targetBlockId,
      childBlockId: sourceIsParent ? targetBlockId : sourceBlockId,
    })
  }
  return pairs
}

/**
 * Replace the persisted pairs for the promoted SOURCE workflows with the live ones. Deleting
 * by the (stable) source-side workflow id first does two things: it nukes pairs for blocks
 * the source deleted since the last sync (e.g. a removed trigger), and it clears the old pair
 * for a workflow whose target was archived + re-created - so the map always reflects the live
 * lineage and a stale pair can never re-home a block onto an archived workflow's id. Block
 * identity is otherwise immutable, so on a steady sync this just deletes and re-inserts the
 * same pairs. `sourceIsParent` is true on pull/create, false on push.
 */
export async function reconcileForkBlockPairs(
  executor: DbOrTx,
  childWorkspaceId: string,
  sourceIsParent: boolean,
  sourceWorkflowIds: string[],
  pairs: ForkBlockPair[]
): Promise<void> {
  if (sourceWorkflowIds.length > 0) {
    const sourceWorkflowColumn = sourceIsParent
      ? workspaceForkBlockMap.parentWorkflowId
      : workspaceForkBlockMap.childWorkflowId
    await executor
      .delete(workspaceForkBlockMap)
      .where(
        and(
          eq(workspaceForkBlockMap.childWorkspaceId, childWorkspaceId),
          inArray(sourceWorkflowColumn, sourceWorkflowIds)
        )
      )
  }
  if (pairs.length === 0) return
  const now = new Date()
  await executor
    .insert(workspaceForkBlockMap)
    .values(
      pairs.map((pair) => ({
        id: generateId(),
        childWorkspaceId,
        parentWorkflowId: pair.parentWorkflowId,
        parentBlockId: pair.parentBlockId,
        childWorkflowId: pair.childWorkflowId,
        childBlockId: pair.childBlockId,
        createdAt: now,
        updatedAt: now,
      }))
    )
    .onConflictDoNothing()
}
