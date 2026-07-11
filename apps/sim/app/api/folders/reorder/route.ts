import { db } from '@sim/db'
import { folder } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { ResourceLockedError } from '@sim/platform-authz/resource-lock'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { reorderFoldersContract } from '@/lib/api/contracts'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { performReorderFolders } from '@/lib/folders/orchestration'
import { FOLDER_RESOURCE_POLICIES } from '@/lib/folders/policy'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('FolderReorderAPI')

export const PUT = withRouteHandler(async (req: NextRequest) => {
  const requestId = generateRequestId()
  const session = await getSession()

  if (!session?.user?.id) {
    logger.warn(`[${requestId}] Unauthorized folder reorder attempt`)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseRequest(reorderFoldersContract, req, {})
    if (!parsed.success) return parsed.response
    const { workspaceId, updates } = parsed.data.body

    const permission = await getUserEntityPermissions(session.user.id, 'workspace', workspaceId)
    if (!permission || permission === 'read') {
      logger.warn(
        `[${requestId}] User ${session.user.id} lacks write permission for workspace ${workspaceId}`
      )
      return NextResponse.json({ error: 'Write access required' }, { status: 403 })
    }

    const folderIds = updates.map((u) => u.id)
    const existingFolders = await db
      .select({
        id: folder.id,
        workspaceId: folder.workspaceId,
        resourceType: folder.resourceType,
      })
      .from(folder)
      .where(and(inArray(folder.id, folderIds), isNull(folder.deletedAt)))

    const validRows = existingFolders.filter((f) => f.workspaceId === workspaceId)
    const validIds = new Set(validRows.map((f) => f.id))
    const resourceTypeById = new Map(validRows.map((f) => [f.id, f.resourceType]))

    // Any id that doesn't resolve to an existing, active, same-workspace folder fails
    // the whole batch up front rather than silently reordering a subset and reporting
    // success with a smaller `updated` count.
    const hasInvalidId = updates.some((u) => !validIds.has(u.id))
    if (hasInvalidId) {
      return NextResponse.json({ error: 'One or more folders were not found' }, { status: 400 })
    }
    const validUpdates = updates

    // A single reorder call operates on one resourceType at a time (the UI never mixes
    // folder types in one drag-drop tree). Reject a mixed-type batch explicitly instead
    // of silently reordering only the first-seen type and reporting success — a caller
    // bug that sends folders from two resource types should surface as an error, not a
    // partial `updated` count with no indication some entries were skipped.
    const resourceType = resourceTypeById.get(validUpdates[0].id)!
    const hasMixedResourceTypes = validUpdates.some(
      (u) => resourceTypeById.get(u.id) !== resourceType
    )
    if (hasMixedResourceTypes) {
      return NextResponse.json(
        { error: 'All folders in a reorder batch must share the same resourceType' },
        { status: 400 }
      )
    }

    // Parent-id existence/workspace/resourceType/deleted validity is re-checked by
    // `performReorderFolders` (via `assertFolderParentValid`) below — this route does
    // not duplicate that check, it only guards the self-parent case which is a
    // cheap synchronous comparison, not a DB round-trip.
    for (const update of validUpdates) {
      if (update.parentId && update.parentId === update.id) {
        return NextResponse.json({ error: 'Folder cannot be its own parent' }, { status: 400 })
      }
    }

    const workspaceFolders = await db
      .select({ id: folder.id, parentId: folder.parentId })
      .from(folder)
      .where(
        and(
          eq(folder.workspaceId, workspaceId),
          eq(folder.resourceType, resourceType),
          isNull(folder.deletedAt)
        )
      )

    const parentById = new Map<string, string | null>()
    for (const folderRow of workspaceFolders) {
      parentById.set(folderRow.id, folderRow.parentId)
    }
    for (const update of validUpdates) {
      if (update.parentId !== undefined) {
        parentById.set(update.id, update.parentId || null)
      }
    }

    for (const update of validUpdates) {
      const visited = new Set<string>()
      let cursor: string | null = update.id
      while (cursor) {
        if (visited.has(cursor)) {
          return NextResponse.json(
            { error: 'Cannot create circular folder reference' },
            { status: 400 }
          )
        }
        visited.add(cursor)
        cursor = parentById.get(cursor) ?? null
      }
    }

    const policy = FOLDER_RESOURCE_POLICIES[resourceType]
    for (const update of validUpdates) {
      await policy.assertMutable(update.id)
      if (update.parentId !== undefined) {
        await policy.assertMutable(update.parentId)
      }
    }

    const result = await performReorderFolders({
      resourceType,
      workspaceId,
      updates: validUpdates,
    })

    if (!result.success) {
      return NextResponse.json(
        { error: result.error ?? 'No valid folders to update' },
        { status: 400 }
      )
    }

    logger.info(`[${requestId}] Reordered ${result.updated} folders in workspace ${workspaceId}`)

    return NextResponse.json({ success: true, updated: result.updated })
  } catch (error) {
    if (error instanceof ResourceLockedError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }

    logger.error(`[${requestId}] Error reordering folders`, error)
    return NextResponse.json({ error: 'Failed to reorder folders' }, { status: 500 })
  }
})
