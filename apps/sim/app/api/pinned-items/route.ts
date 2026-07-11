import {
  db,
  folder,
  knowledgeBase,
  pinnedItem,
  userTableDefinitions,
  workflow,
  workspaceFiles,
} from '@sim/db'
import { createLogger } from '@sim/logger'
import { getPostgresErrorCode } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core'
import { type NextRequest, NextResponse } from 'next/server'
import type { PinnedResourceType } from '@/lib/api/contracts'
import { createPinnedItemContract, listPinnedItemsContract } from '@/lib/api/contracts'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('PinnedItemsAPI')

/**
 * Per-resourceType table/column wiring for {@link resourceExistsInWorkspace}.
 * Mirrors the `FolderCascadeConfig` pattern in `lib/folders/orchestration.ts`
 * — the delta between resource types is just which table/columns to query,
 * so it's captured as data instead of one copy-pasted switch-case per type.
 */
interface PinnedResourceLookupConfig {
  resourceTable: PgTable
  idColumn: PgColumn
  workspaceColumn: PgColumn
  /** Soft-delete timestamp column; the resource is active when this is null. */
  deletedColumn: PgColumn
}

const PINNED_RESOURCE_LOOKUP: Record<PinnedResourceType, PinnedResourceLookupConfig> = {
  folder: {
    resourceTable: folder,
    idColumn: folder.id,
    workspaceColumn: folder.workspaceId,
    deletedColumn: folder.deletedAt,
  },
  workflow: {
    resourceTable: workflow,
    idColumn: workflow.id,
    workspaceColumn: workflow.workspaceId,
    deletedColumn: workflow.archivedAt,
  },
  file: {
    resourceTable: workspaceFiles,
    idColumn: workspaceFiles.id,
    workspaceColumn: workspaceFiles.workspaceId,
    deletedColumn: workspaceFiles.deletedAt,
  },
  knowledge_base: {
    resourceTable: knowledgeBase,
    idColumn: knowledgeBase.id,
    workspaceColumn: knowledgeBase.workspaceId,
    deletedColumn: knowledgeBase.deletedAt,
  },
  table: {
    resourceTable: userTableDefinitions,
    idColumn: userTableDefinitions.id,
    workspaceColumn: userTableDefinitions.workspaceId,
    deletedColumn: userTableDefinitions.archivedAt,
  },
}

/**
 * Verifies `resourceId` actually exists, belongs to `workspaceId`, and is not
 * soft-deleted — otherwise a pin can be created pointing at a nonexistent or
 * cross-workspace resource. Mirrors the workspace-scoped existence checks the
 * `/api/folders` routes already perform.
 */
async function resourceExistsInWorkspace(
  resourceType: PinnedResourceType,
  resourceId: string,
  workspaceId: string
): Promise<boolean> {
  const config = PINNED_RESOURCE_LOOKUP[resourceType]
  const [row] = await db
    .select({ id: config.idColumn })
    .from(config.resourceTable)
    .where(
      and(
        eq(config.idColumn, resourceId),
        eq(config.workspaceColumn, workspaceId),
        isNull(config.deletedColumn)
      )
    )
    .limit(1)
  return Boolean(row)
}

function toPinnedItemApi(row: typeof pinnedItem.$inferSelect) {
  return { ...row, pinnedAt: row.pinnedAt.toISOString() }
}

/**
 * Drops pins whose underlying resource has since been deleted/archived —
 * without this, a pin outlives its resource forever (the resource's own
 * delete never touches `pinned_item`), and a consumer that renders pins
 * without cross-referencing the live resource list would show a phantom
 * entry. Batches one existence query per distinct resourceType present in
 * `rows` (not one per row) to stay O(types) instead of O(n).
 */
async function filterActivePinnedItems(
  rows: (typeof pinnedItem.$inferSelect)[],
  workspaceId: string
): Promise<(typeof pinnedItem.$inferSelect)[]> {
  const idsByType = new Map<PinnedResourceType, string[]>()
  for (const row of rows) {
    const type = row.resourceType as PinnedResourceType
    const ids = idsByType.get(type) ?? []
    ids.push(row.resourceId)
    idsByType.set(type, ids)
  }

  const activeIdsByType = new Map<PinnedResourceType, Set<string>>()
  await Promise.all(
    Array.from(idsByType.entries()).map(async ([type, ids]) => {
      const config = PINNED_RESOURCE_LOOKUP[type]
      const activeRows = await db
        .select({ id: config.idColumn })
        .from(config.resourceTable)
        .where(
          and(
            inArray(config.idColumn, ids),
            eq(config.workspaceColumn, workspaceId),
            isNull(config.deletedColumn)
          )
        )
      activeIdsByType.set(type, new Set(activeRows.map((r) => r.id as string)))
    })
  )

  return rows.filter((row) =>
    activeIdsByType.get(row.resourceType as PinnedResourceType)?.has(row.resourceId)
  )
}

/** Lists pinned items for a workspace, optionally filtered to a single `resourceType`. */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = await parseRequest(listPinnedItemsContract, request, {})
  if (!parsed.success) return parsed.response
  const { workspaceId, resourceType } = parsed.data.query

  const permission = await getUserEntityPermissions(session.user.id, 'workspace', workspaceId)
  if (!permission) {
    return NextResponse.json({ error: 'Access denied to this workspace' }, { status: 403 })
  }

  const rows = await db
    .select()
    .from(pinnedItem)
    .where(
      resourceType
        ? and(
            eq(pinnedItem.userId, session.user.id),
            eq(pinnedItem.workspaceId, workspaceId),
            eq(pinnedItem.resourceType, resourceType)
          )
        : and(eq(pinnedItem.userId, session.user.id), eq(pinnedItem.workspaceId, workspaceId))
    )

  const activeRows = await filterActivePinnedItems(rows, workspaceId)
  return NextResponse.json({ pinnedItems: activeRows.map(toPinnedItemApi) })
})

export const POST = withRouteHandler(async (request: NextRequest) => {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = await parseRequest(createPinnedItemContract, request, {})
  if (!parsed.success) return parsed.response
  const { workspaceId, resourceType, resourceId } = parsed.data.body

  const permission = await getUserEntityPermissions(session.user.id, 'workspace', workspaceId)
  if (!permission) {
    return NextResponse.json({ error: 'Access denied to this workspace' }, { status: 403 })
  }

  const exists = await resourceExistsInWorkspace(resourceType, resourceId, workspaceId)
  if (!exists) {
    return NextResponse.json({ error: 'Resource not found in this workspace' }, { status: 404 })
  }

  try {
    const [created] = await db
      .insert(pinnedItem)
      .values({
        id: generateId(),
        userId: session.user.id,
        workspaceId,
        resourceType,
        resourceId,
      })
      .returning()

    return NextResponse.json({ pinnedItem: toPinnedItemApi(created) }, { status: 201 })
  } catch (error) {
    if (getPostgresErrorCode(error) === '23505') {
      return NextResponse.json({ error: 'This item is already pinned' }, { status: 409 })
    }
    logger.error('Error creating pinned item', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})
