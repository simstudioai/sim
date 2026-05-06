import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { workflow, workflowFolder } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { FolderLockedError } from '@sim/workflow-authz'
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

// POST /api/folders/[id]/duplicate - Duplicate a folder with all its child folders and workflows
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
      const { name, workspaceId, parentId, color, newId: clientNewId } = parsed.data.body

      logger.info(`[${requestId}] Duplicating folder ${sourceFolderId} for user ${session.user.id}`)

      const sourceFolder = await db
        .select()
        .from(workflowFolder)
        .where(and(eq(workflowFolder.id, sourceFolderId), isNull(workflowFolder.archivedAt)))
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
          ? eq(workflowFolder.parentId, targetParentId)
          : isNull(workflowFolder.parentId)
        const workflowParentCondition = targetParentId
          ? eq(workflow.folderId, targetParentId)
          : isNull(workflow.folderId)

        const [[folderResult], [workflowResult]] = await Promise.all([
          tx
            .select({ minSortOrder: min(workflowFolder.sortOrder) })
            .from(workflowFolder)
            .where(and(eq(workflowFolder.workspaceId, targetWorkspaceId), folderParentCondition)),
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

        await tx.insert(workflowFolder).values({
          id: newFolderId,
          userId: session.user.id,
          workspaceId: targetWorkspaceId,
          name: deduplicatedName,
          color: color || sourceFolder.color,
          parentId: targetParentId,
          sortOrder,
          isExpanded: false,
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
        .from(workflowFolder)
        .where(eq(workflowFolder.id, newFolderId))
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

async function assertTargetParentFolderMutable(
  tx: DbOrTx,
  parentId: string | null,
  targetWorkspaceId: string,
  sourceFolderId: string
): Promise<void> {
  let currentFolderId = parentId
  const visited = new Set<string>()

  while (currentFolderId && !visited.has(currentFolderId)) {
    visited.add(currentFolderId)
    const [folder] = await tx
      .select({
        id: workflowFolder.id,
        parentId: workflowFolder.parentId,
        workspaceId: workflowFolder.workspaceId,
        locked: workflowFolder.locked,
        archivedAt: workflowFolder.archivedAt,
      })
      .from(workflowFolder)
      .where(eq(workflowFolder.id, currentFolderId))
      .limit(1)

    if (!folder || folder.workspaceId !== targetWorkspaceId || folder.archivedAt) {
      throw new Error('Target parent folder not found')
    }
    if (folder.id === sourceFolderId) {
      throw new Error('Cannot duplicate folder into itself or one of its descendants')
    }
    if (folder.locked) {
      throw new FolderLockedError()
    }

    currentFolderId = folder.parentId
  }
}

async function deduplicateFolderName(
  tx: DbOrTx,
  workspaceId: string,
  parentId: string | null,
  requestedName: string
): Promise<string> {
  const parentCondition = parentId
    ? eq(workflowFolder.parentId, parentId)
    : isNull(workflowFolder.parentId)
  const siblingRows = await tx
    .select({ name: workflowFolder.name })
    .from(workflowFolder)
    .where(
      and(
        eq(workflowFolder.workspaceId, workspaceId),
        parentCondition,
        isNull(workflowFolder.archivedAt)
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
    .from(workflowFolder)
    .where(
      and(
        eq(workflowFolder.parentId, sourceFolderId),
        eq(workflowFolder.workspaceId, sourceWorkspaceId),
        isNull(workflowFolder.archivedAt)
      )
    )

  for (const childFolder of childFolders) {
    const newChildFolderId = generateId()
    folderMapping.set(childFolder.id, newChildFolderId)

    await tx.insert(workflowFolder).values({
      id: newChildFolderId,
      userId,
      workspaceId: targetWorkspaceId,
      name: childFolder.name,
      color: childFolder.color,
      parentId: newParentFolderId,
      sortOrder: childFolder.sortOrder,
      isExpanded: false,
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
        color: sourceWorkflow.color,
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
