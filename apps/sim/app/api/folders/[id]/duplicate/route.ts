import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { folder as folderTable, workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { FolderLockedError } from '@sim/platform-authz/workflow'
import { generateId } from '@sim/utils/id'
import { and, eq, isNull, min } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { duplicateFolderContract } from '@/lib/api/contracts'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import type { DbOrTx } from '@/lib/db/types'
import { duplicateWorkflow } from '@/lib/workflows/persistence/duplicate'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('FolderDuplicateAPI')

/**
 * POST /api/folders/[id]/duplicate — deep-copies a workflow folder (its child
 * folder tree and every contained workflow).
 *
 * This endpoint is intentionally `workflow`-only: duplication means cloning
 * workflow *definitions*, which has no generic equivalent for file/
 * knowledge_base/table folders yet, so — unlike the other `/api/folders`
 * routes — it does not read `resourceType` off the row and dispatch. Passing
 * a non-workflow folder id resolves to no source row and returns 404. When a
 * second resource type gains a real duplicate semantic, lift this into a
 * `performDuplicateFolder` dispatcher alongside the other orchestration fns.
 */
export const POST = withRouteHandler(
  async (req: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const { id: sourceFolderId } = await context.params
    const requestId = generateRequestId()
    const startTime = Date.now()

    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized folder duplication attempt for ${sourceFolderId}`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    try {
      const parsed = await parseRequest(duplicateFolderContract, req, context)
      if (!parsed.success) return parsed.response
      const { name, workspaceId, parentId, newId: clientNewId } = parsed.data.body

      logger.info(`[${requestId}] Duplicating folder ${sourceFolderId} for user ${session.user.id}`)

      const sourceFolder = await db
        .select()
        .from(folderTable)
        .where(
          and(
            eq(folderTable.id, sourceFolderId),
            eq(folderTable.resourceType, 'workflow'),
            isNull(folderTable.deletedAt)
          )
        )
        .then((rows) => rows[0])

      if (!sourceFolder) {
        throw new Error('Source folder not found')
      }

      const userPermission = await getUserEntityPermissions(
        session.user.id,
        'workspace',
        sourceFolder.workspaceId
      )

      if (!userPermission || userPermission === 'read') {
        throw new Error('Source folder not found or access denied')
      }

      const targetWorkspaceId = workspaceId || sourceFolder.workspaceId
      if (targetWorkspaceId !== sourceFolder.workspaceId) {
        throw new Error('Cross-workspace folder duplication is not supported')
      }

      const { newFolderId, folderMapping, workflowStats } = await db.transaction(async (tx) => {
        const newFolderId = clientNewId || generateId()
        const now = new Date()
        const targetParentId = parentId ?? sourceFolder.parentId
        await assertTargetParentFolderMutable(tx, targetParentId, targetWorkspaceId, sourceFolderId)

        const folderParentCondition = targetParentId
          ? eq(folderTable.parentId, targetParentId)
          : isNull(folderTable.parentId)
        const workflowParentCondition = targetParentId
          ? eq(workflow.folderId, targetParentId)
          : isNull(workflow.folderId)

        const [[folderResult], [workflowResult]] = await Promise.all([
          tx
            .select({ minSortOrder: min(folderTable.sortOrder) })
            .from(folderTable)
            .where(
              and(
                eq(folderTable.workspaceId, targetWorkspaceId),
                eq(folderTable.resourceType, 'workflow'),
                folderParentCondition
              )
            ),
          tx
            .select({ minSortOrder: min(workflow.sortOrder) })
            .from(workflow)
            .where(and(eq(workflow.workspaceId, targetWorkspaceId), workflowParentCondition)),
        ])

        const minSortOrder = [folderResult?.minSortOrder, workflowResult?.minSortOrder].reduce<
          number | null
        >((currentMin, candidate) => {
          if (candidate == null) return currentMin
          if (currentMin == null) return candidate
          return Math.min(currentMin, candidate)
        }, null)
        const sortOrder = minSortOrder != null ? minSortOrder - 1 : 0
        const deduplicatedName = await deduplicateFolderName(
          tx,
          targetWorkspaceId,
          targetParentId,
          name
        )

        await tx.insert(folderTable).values({
          id: newFolderId,
          resourceType: 'workflow',
          userId: session.user.id,
          workspaceId: targetWorkspaceId,
          name: deduplicatedName,
          parentId: targetParentId,
          sortOrder,
          locked: false,
          createdAt: now,
          updatedAt: now,
        })

        const folderMapping = new Map<string, string>([[sourceFolderId, newFolderId]])
        await duplicateFolderStructure(
          tx,
          sourceFolderId,
          newFolderId,
          sourceFolder.workspaceId,
          targetWorkspaceId,
          session.user.id,
          now,
          folderMapping
        )

        const workflowStats = await duplicateWorkflowsInFolderTree(
          tx,
          sourceFolder.workspaceId,
          targetWorkspaceId,
          folderMapping,
          session.user.id,
          requestId
        )

        return { newFolderId, folderMapping, workflowStats }
      })

      const elapsed = Date.now() - startTime
      logger.info(
        `[${requestId}] Successfully duplicated folder ${sourceFolderId} to ${newFolderId} in ${elapsed}ms`,
        {
          foldersCount: folderMapping.size,
          workflowsCount: workflowStats.total,
          workflowsSucceeded: workflowStats.succeeded,
        }
      )

      recordAudit({
        workspaceId: targetWorkspaceId,
        actorId: session.user.id,
        action: AuditAction.FOLDER_DUPLICATED,
        resourceType: AuditResourceType.FOLDER,
        resourceId: newFolderId,
        actorName: session.user.name ?? undefined,
        actorEmail: session.user.email ?? undefined,
        resourceName: name,
        description: `Duplicated folder "${sourceFolder.name}" as "${name}"`,
        metadata: {
          sourceId: sourceFolder.id,
          affected: { workflows: workflowStats.succeeded, folders: folderMapping.size },
        },
        request: req,
      })

      const duplicatedFolder = await db
        .select()
        .from(folderTable)
        .where(and(eq(folderTable.id, newFolderId), eq(folderTable.resourceType, 'workflow')))
        .then((rows) => rows[0])

      return NextResponse.json({ folder: duplicatedFolder }, { status: 201 })
    } catch (error) {
      if (error instanceof Error) {
        if (error instanceof FolderLockedError) {
          return NextResponse.json({ error: error.message }, { status: error.status })
        }

        if (error.message === 'Source folder not found') {
          logger.warn(`[${requestId}] Source folder ${sourceFolderId} not found`)
          return NextResponse.json({ error: 'Source folder not found' }, { status: 404 })
        }

        if (error.message === 'Source folder not found or access denied') {
          logger.warn(
            `[${requestId}] User ${session.user.id} denied access to source folder ${sourceFolderId}`
          )
          return NextResponse.json({ error: 'Access denied' }, { status: 403 })
        }

        if (error.message === 'Cross-workspace folder duplication is not supported') {
          logger.warn(
            `[${requestId}] User ${session.user.id} attempted cross-workspace folder duplication for ${sourceFolderId}`
          )
          return NextResponse.json({ error: error.message }, { status: 400 })
        }

        if (
          error.message === 'Target parent folder not found' ||
          error.message === 'Cannot duplicate folder into itself or one of its descendants'
        ) {
          return NextResponse.json({ error: error.message }, { status: 400 })
        }
      }

      const elapsed = Date.now() - startTime
      logger.error(
        `[${requestId}] Error duplicating folder ${sourceFolderId} after ${elapsed}ms:`,
        error
      )
      return NextResponse.json({ error: 'Failed to duplicate folder' }, { status: 500 })
    }
  }
)

/**
 * Verifies a prospective duplicate-target parent is usable: the same
 * existence/workspace/resourceType/deleted invariant every other folder
 * write path checks via `assertFolderParentValid` is applied inline to the
 * immediate parent's row (the first loop iteration below), then the walk
 * continues up the full ancestor chain applying the workflow-specific
 * lock-cascade and self-descendant checks. `deletedAt` is re-checked on
 * EVERY hop, not just the immediate parent — the `folder_parent_resource_type_match`
 * trigger only fires when a `parent_id` edge is written, so it can't catch an
 * ancestor further up the chain being soft-deleted independently afterwards
 * (e.g. via a bulk admin import that writes `folder` rows directly). Only
 * workspace/resourceType consistency is safe to check first-iteration-only,
 * since the trigger enforces those on every write, including admin paths.
 * Checking inline on the one row already being fetched for the walk avoids a
 * redundant second SELECT of the same immediate-parent row that a separate
 * `assertFolderParentValid` call would issue.
 */
export async function assertTargetParentFolderMutable(
  tx: DbOrTx,
  parentId: string | null,
  targetWorkspaceId: string,
  sourceFolderId: string
): Promise<void> {
  if (!parentId) return

  let currentFolderId: string | null = parentId
  const visited = new Set<string>()
  let isFirstIteration = true

  while (currentFolderId && !visited.has(currentFolderId)) {
    visited.add(currentFolderId)
    const [folder] = await tx
      .select({
        id: folderTable.id,
        parentId: folderTable.parentId,
        locked: folderTable.locked,
        workspaceId: folderTable.workspaceId,
        resourceType: folderTable.resourceType,
        deletedAt: folderTable.deletedAt,
      })
      .from(folderTable)
      .where(eq(folderTable.id, currentFolderId))
      .limit(1)

    if (
      !folder ||
      folder.deletedAt ||
      (isFirstIteration &&
        (folder.workspaceId !== targetWorkspaceId || folder.resourceType !== 'workflow'))
    ) {
      throw new Error('Target parent folder not found')
    }
    if (folder.id === sourceFolderId) {
      throw new Error('Cannot duplicate folder into itself or one of its descendants')
    }
    if (folder.locked) {
      throw new FolderLockedError()
    }

    currentFolderId = folder.parentId
    isFirstIteration = false
  }
}

async function deduplicateFolderName(
  tx: DbOrTx,
  workspaceId: string,
  parentId: string | null,
  requestedName: string
): Promise<string> {
  const parentCondition = parentId
    ? eq(folderTable.parentId, parentId)
    : isNull(folderTable.parentId)
  const siblingRows = await tx
    .select({ name: folderTable.name })
    .from(folderTable)
    .where(
      and(
        eq(folderTable.workspaceId, workspaceId),
        eq(folderTable.resourceType, 'workflow'),
        parentCondition,
        isNull(folderTable.deletedAt)
      )
    )
  const siblingNames = new Set(siblingRows.map((row) => row.name))
  if (!siblingNames.has(requestedName)) return requestedName

  let suffix = 1
  let candidate = `${requestedName} (${suffix})`
  while (siblingNames.has(candidate)) {
    suffix += 1
    candidate = `${requestedName} (${suffix})`
  }
  return candidate
}

async function duplicateFolderStructure(
  tx: DbOrTx,
  sourceFolderId: string,
  newParentFolderId: string,
  sourceWorkspaceId: string,
  targetWorkspaceId: string,
  userId: string,
  timestamp: Date,
  folderMapping: Map<string, string>
): Promise<void> {
  const childFolders = await tx
    .select()
    .from(folderTable)
    .where(
      and(
        eq(folderTable.parentId, sourceFolderId),
        eq(folderTable.workspaceId, sourceWorkspaceId),
        eq(folderTable.resourceType, 'workflow'),
        isNull(folderTable.deletedAt)
      )
    )

  for (const childFolder of childFolders) {
    const newChildFolderId = generateId()
    folderMapping.set(childFolder.id, newChildFolderId)

    await tx.insert(folderTable).values({
      id: newChildFolderId,
      resourceType: 'workflow',
      userId,
      workspaceId: targetWorkspaceId,
      name: childFolder.name,
      parentId: newParentFolderId,
      sortOrder: childFolder.sortOrder,
      locked: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    })

    await duplicateFolderStructure(
      tx,
      childFolder.id,
      newChildFolderId,
      sourceWorkspaceId,
      targetWorkspaceId,
      userId,
      timestamp,
      folderMapping
    )
  }
}

async function duplicateWorkflowsInFolderTree(
  tx: DbOrTx,
  sourceWorkspaceId: string,
  targetWorkspaceId: string,
  folderMapping: Map<string, string>,
  userId: string,
  requestId: string
): Promise<{ total: number; succeeded: number }> {
  const stats = { total: 0, succeeded: 0 }
  const workflowsByNewFolder = new Map<string, Array<typeof workflow.$inferSelect>>()
  const workflowIdMap = new Map<string, string>()

  for (const [oldFolderId, newFolderId] of folderMapping.entries()) {
    const workflowsInFolder = await tx
      .select()
      .from(workflow)
      .where(
        and(
          eq(workflow.folderId, oldFolderId),
          eq(workflow.workspaceId, sourceWorkspaceId),
          isNull(workflow.archivedAt)
        )
      )

    stats.total += workflowsInFolder.length
    workflowsByNewFolder.set(newFolderId, workflowsInFolder)
    for (const sourceWorkflow of workflowsInFolder) {
      workflowIdMap.set(sourceWorkflow.id, generateId())
    }
  }

  for (const [newFolderId, workflowsInFolder] of workflowsByNewFolder.entries()) {
    for (const sourceWorkflow of workflowsInFolder) {
      await duplicateWorkflow({
        sourceWorkflowId: sourceWorkflow.id,
        userId,
        name: sourceWorkflow.name,
        description: sourceWorkflow.description || undefined,
        workspaceId: targetWorkspaceId,
        folderId: newFolderId,
        requestId,
        tx,
        newWorkflowId: workflowIdMap.get(sourceWorkflow.id),
        workflowIdMap,
      })

      stats.succeeded++
    }
  }

  return stats
}
