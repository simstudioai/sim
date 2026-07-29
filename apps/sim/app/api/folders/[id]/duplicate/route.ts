import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { folder as folderTable, workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { FolderLockedError } from '@sim/platform-authz/workflow'
import { getPostgresErrorCode } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, eq, isNull } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { duplicateFolderContract } from '@/lib/api/contracts'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import type { DbOrTx } from '@/lib/db/types'
import { nextFolderSortOrder } from '@/lib/folders/lifecycle'
import { deduplicateFolderName } from '@/lib/folders/naming'
import { toFolderApi } from '@/lib/folders/queries'
import { duplicateWorkflow } from '@/lib/workflows/persistence/duplicate'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('FolderDuplicateAPI')

/**
 * Duplication only ever copies workflow folders. Named once so the scope is stated rather
 * than restated as a literal at every query — the engine reads its resourceType from config
 * for exactly this reason.
 */
const FOLDER_RESOURCE_TYPE = 'workflow' as const

/**
 * Carries the HTTP status with the failure, so the handler maps errors by type instead of by
 * comparing `error.message` to a literal — a coupling that breaks silently the moment
 * someone rewords a message.
 */
class FolderDuplicationError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Message returned to the caller when it must differ from the logged one. */
    readonly publicMessage: string = message
  ) {
    super(message)
    this.name = 'FolderDuplicationError'
  }
}

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
      const { name, workspaceId, parentId, newId: clientNewId } = parsed.data.body

      logger.info(`[${requestId}] Duplicating folder ${sourceFolderId} for user ${session.user.id}`)

      const sourceFolder = await db
        .select()
        .from(folderTable)
        .where(
          and(
            eq(folderTable.id, sourceFolderId),
            isNull(folderTable.deletedAt),
            eq(folderTable.resourceType, FOLDER_RESOURCE_TYPE)
          )
        )
        .then((rows) => rows[0])

      if (!sourceFolder) {
        throw new FolderDuplicationError('Source folder not found', 404)
      }

      const userPermission = await getUserEntityPermissions(
        session.user.id,
        'workspace',
        sourceFolder.workspaceId
      )

      if (!userPermission || userPermission === 'read') {
        throw new FolderDuplicationError(
          'Source folder not found or access denied',
          403,
          'Access denied'
        )
      }

      const targetWorkspaceId = workspaceId || sourceFolder.workspaceId
      if (targetWorkspaceId !== sourceFolder.workspaceId) {
        throw new FolderDuplicationError('Cross-workspace folder duplication is not supported', 400)
      }

      const { newFolderId, folderMapping, workflowStats } = await db.transaction(async (tx) => {
        const newFolderId = clientNewId || generateId()
        const now = new Date()
        const targetParentId = parentId ?? sourceFolder.parentId
        await assertTargetParentFolderMutable(tx, targetParentId, targetWorkspaceId, sourceFolderId)

        // Placement is the engine's rule (folders and workflows share one ordering space),
        // so it is read from there rather than recomputed here.
        const sortOrder = await nextFolderSortOrder(
          FOLDER_RESOURCE_TYPE,
          targetWorkspaceId,
          targetParentId,
          tx
        )

        const deduplicatedName = await deduplicateFolderName(
          tx,
          targetWorkspaceId,
          targetParentId,
          name,
          FOLDER_RESOURCE_TYPE
        )

        try {
          await tx.insert(folderTable).values({
            id: newFolderId,
            resourceType: FOLDER_RESOURCE_TYPE,
            userId: session.user.id,
            workspaceId: targetWorkspaceId,
            name: deduplicatedName,
            parentId: targetParentId,
            sortOrder,
            locked: false,
            createdAt: now,
            updatedAt: now,
          })
        } catch (insertError) {
          /**
           * Scoped to THIS insert on purpose. A 23505 here is one of two real conflicts the
           * caller can act on: `newId` is client-supplied, so replaying a duplicate whose
           * response was lost hits the primary key; and `deduplicateFolderName` runs before
           * the write, so a concurrent create can still take the name in between.
           *
           * Catching 23505 across the whole handler instead would relabel any unique violation
           * raised while copying the workflows inside the folder — a different constraint, on a
           * different table — as a folder-name conflict, which is both wrong and misleading.
           * Those keep falling through to the generic 500.
           */
          if (getPostgresErrorCode(insertError) !== '23505') throw insertError
          throw new FolderDuplicationError(
            `Folder duplication conflicted for ${sourceFolderId}`,
            409,
            'A folder with this name already exists in this location'
          )
        }

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
        .where(
          and(eq(folderTable.id, newFolderId), eq(folderTable.resourceType, FOLDER_RESOURCE_TYPE))
        )
        .then((rows) => rows[0])

      return NextResponse.json({ folder: toFolderApi(duplicatedFolder) }, { status: 201 })
    } catch (error) {
      if (error instanceof FolderLockedError) {
        return NextResponse.json({ error: error.message }, { status: error.status })
      }

      if (error instanceof FolderDuplicationError) {
        logger.warn(`[${requestId}] Folder duplication rejected: ${error.message}`, {
          sourceFolderId,
          userId: session.user.id,
        })
        return NextResponse.json({ error: error.publicMessage }, { status: error.status })
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
        id: folderTable.id,
        parentId: folderTable.parentId,
        workspaceId: folderTable.workspaceId,
        locked: folderTable.locked,
        archivedAt: folderTable.deletedAt,
      })
      .from(folderTable)
      .where(
        and(eq(folderTable.id, currentFolderId), eq(folderTable.resourceType, FOLDER_RESOURCE_TYPE))
      )
      .limit(1)

    if (!folder || folder.workspaceId !== targetWorkspaceId || folder.archivedAt) {
      throw new FolderDuplicationError('Target parent folder not found', 400)
    }
    if (folder.id === sourceFolderId) {
      throw new FolderDuplicationError(
        'Cannot duplicate folder into itself or one of its descendants',
        400
      )
    }
    if (folder.locked) {
      throw new FolderLockedError()
    }

    currentFolderId = folder.parentId
  }
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
        eq(folderTable.resourceType, FOLDER_RESOURCE_TYPE),
        isNull(folderTable.deletedAt)
      )
    )

  for (const childFolder of childFolders) {
    const newChildFolderId = generateId()
    folderMapping.set(childFolder.id, newChildFolderId)

    await tx.insert(folderTable).values({
      id: newChildFolderId,
      resourceType: FOLDER_RESOURCE_TYPE,
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
