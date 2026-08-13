import { db } from '@sim/db'
import { pinnedItem } from '@sim/db/schema'
import { and, eq, ne } from 'drizzle-orm'
import {
  type PinnedItemApi,
  type PinnedResourceType,
  pinnedResourceTypeSchema,
} from '@/lib/api/contracts/pinned-items'
import { filterToActiveResources } from '@/lib/pinned-items/resources'

/**
 * Narrows a stored row to the wire shape, dropping any row whose `resourceType` this build does
 * not recognise.
 *
 * `pinned_item.resource_type` is plain `text` — deliberately, so the set of pinnable kinds can
 * grow — while the contract is a closed enum. During a rolling deploy an older pod can therefore
 * read a pin a newer one wrote. Returning it would fail response validation and take the WHOLE
 * list down rather than the single row, so the unknown kind is skipped instead.
 *
 * `filterToActiveResources` already drops these as a side effect of not having a table to look
 * them up in; this makes the guarantee explicit and compiler-checked at the wire boundary.
 */
function toPinnedItemApi(row: typeof pinnedItem.$inferSelect): PinnedItemApi | null {
  const resourceType = pinnedResourceTypeSchema.safeParse(row.resourceType)
  if (!resourceType.success) return null
  return { ...row, resourceType: resourceType.data, pinnedAt: row.pinnedAt.toISOString() }
}

/**
 * Lists one user's pinned items in a workspace, already narrowed to the `PinnedItemApi` wire
 * shape and filtered to pins whose resource still exists.
 *
 * Shared by `GET /api/pinned-items` and the resource-page prefetch so a hydrated cache entry and
 * a client fetch can never disagree. It carries no authorization of its own — every caller must
 * prove the viewer's workspace access first.
 */
export async function listPinnedItemsForUser(
  userId: string,
  workspaceId: string,
  resourceType?: PinnedResourceType
): Promise<PinnedItemApi[]> {
  const rows = await db
    .select()
    .from(pinnedItem)
    .where(
      and(
        eq(pinnedItem.userId, userId),
        eq(pinnedItem.workspaceId, workspaceId),
        /**
         * A `workspace` pin stores `workspaceId === resourceId`, so it would otherwise
         * appear in this workspace's unscoped listing as a resource *inside* itself.
         * It is read from the workspace-list payload instead, so it is excluded here
         * rather than left for a future unscoped caller to mistake for a real resource.
         */
        resourceType
          ? eq(pinnedItem.resourceType, resourceType)
          : ne(pinnedItem.resourceType, 'workspace')
      )
    )

  const activeRows = await filterToActiveResources(rows, workspaceId)

  return activeRows.map(toPinnedItemApi).filter((item): item is PinnedItemApi => item !== null)
}
