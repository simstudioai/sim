import { db } from '@sim/db'
import { workflow, workflowFolder } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { getUserEntityPermissions } from '@/lib/permissions/utils'
import { generateRequestId } from '@/lib/utils'
import { duplicateWorkflow } from '@/lib/workflows/duplicate'

const logger = createLogger('FolderDuplicateAPI')

const DuplicateRequestSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  workspaceId: z.string().optional(),
  parentId: z.string().nullable().optional(),
  color: z.string().optional(),
})

// POST /api/folders/[id]/duplicate - Duplicate a folder with all its child folders and workflows
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: sourceFolderId } = await params
  const requestId = generateRequestId()
  const startTime = Date.now()

  const session = await getSession()
  if (!session?.user?.id) {
    logger.warn(`[${requestId}] Unauthorized folder duplication attempt for ${sourceFolderId}`)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json()
    const { name, workspaceId, parentId, color } = DuplicateRequestSchema.parse(body)

    logger.info(`[${requestId}] Duplicating folder ${sourceFolderId} for user ${session.user.id}`)

    // Verify the source folder exists
    const sourceFolder = await db
      .select()
      .from(workflowFolder)
      .where(eq(workflowFolder.id, sourceFolderId))
      .then((rows) => rows[0])

    if (!sourceFolder) {
      throw new Error('Source folder not found')
    }

    // Check if user has permission to access the source folder
    const userPermission = await getUserEntityPermissions(
      session.user.id,
      'workspace',
      sourceFolder.workspaceId
    )

    if (!userPermission || userPermission === 'read') {
      throw new Error('Source folder not found or access denied')
    }

    const targetWorkspaceId = workspaceId || sourceFolder.workspaceId

    // Step 1: Duplicate folder structure
    const { newFolderId, folderMapping } = await db.transaction(async (tx) => {
      const newFolderId = crypto.randomUUID()
      const now = new Date()

      // Create the new root folder
      await tx.insert(workflowFolder).values({
        id: newFolderId,
        userId: session.user.id,
        workspaceId: targetWorkspaceId,
        name,
        color: color || sourceFolder.color,
        parentId: parentId || sourceFolder.parentId,
        sortOrder: sourceFolder.sortOrder,
        isExpanded: false,
        createdAt: now,
        updatedAt: now,
      })

      // Recursively duplicate child folders
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

      return { newFolderId, folderMapping }
    })

    // Step 2: Duplicate workflows
    const workflowStats = await duplicateWorkflowsInFolderTree(
      sourceFolder.workspaceId,
      targetWorkspaceId,
      folderMapping,
      session.user.id,
      requestId
    )

    const elapsed = Date.now() - startTime
    logger.info(
      `[${requestId}] Successfully duplicated folder ${sourceFolderId} to ${newFolderId} in ${elapsed}ms`,
      {
        foldersCount: folderMapping.size,
        workflowsCount: workflowStats.total,
        workflowsSucceeded: workflowStats.succeeded,
        workflowsFailed: workflowStats.failed,
      }
    )

    return NextResponse.json(
      {
        id: newFolderId,
        name,
        color: color || sourceFolder.color,
        workspaceId: targetWorkspaceId,
        parentId: parentId || sourceFolder.parentId,
        foldersCount: folderMapping.size,
        workflowsCount: workflowStats.succeeded,
      },
      { status: 201 }
    )
  } catch (error) {
    if (error instanceof Error) {
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
    }

    if (error instanceof z.ZodError) {
      logger.warn(`[${requestId}] Invalid duplication request data`, { errors: error.errors })
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }

    const elapsed = Date.now() - startTime
    logger.error(
      `[${requestId}] Error duplicating folder ${sourceFolderId} after ${elapsed}ms:`,
      error
    )
    return NextResponse.json({ error: 'Failed to duplicate folder' }, { status: 500 })
  }
}

// Helper to recursively duplicate folder structure
async function duplicateFolderStructure(
  tx: any,
  sourceFolderId: string,
  newParentFolderId: string,
  sourceWorkspaceId: string,
  targetWorkspaceId: string,
  userId: string,
  timestamp: Date,
  folderMapping: Map<string, string>
): Promise<void> {
  // Get all child folders
  const childFolders = await tx
    .select()
    .from(workflowFolder)
    .where(
      and(
        eq(workflowFolder.parentId, sourceFolderId),
        eq(workflowFolder.workspaceId, sourceWorkspaceId)
      )
    )

  // Create each child folder and recurse
  for (const childFolder of childFolders) {
    const newChildFolderId = crypto.randomUUID()
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
      createdAt: timestamp,
      updatedAt: timestamp,
    })

    // Recurse for this child's children
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

// Helper to duplicate all workflows in a folder tree
async function duplicateWorkflowsInFolderTree(
  sourceWorkspaceId: string,
  targetWorkspaceId: string,
  folderMapping: Map<string, string>,
  userId: string,
  requestId: string
): Promise<{ total: number; succeeded: number; failed: number }> {
  const stats = { total: 0, succeeded: 0, failed: 0 }

  // Process each folder in the mapping
  for (const [oldFolderId, newFolderId] of folderMapping.entries()) {
    // Get workflows in this folder
    const workflowsInFolder = await db
      .select()
      .from(workflow)
      .where(and(eq(workflow.folderId, oldFolderId), eq(workflow.workspaceId, sourceWorkspaceId)))

    stats.total += workflowsInFolder.length

    // Duplicate each workflow
    for (const sourceWorkflow of workflowsInFolder) {
      try {
        await duplicateWorkflow({
          sourceWorkflowId: sourceWorkflow.id,
          userId,
          name: sourceWorkflow.name,
          description: sourceWorkflow.description || undefined,
          color: sourceWorkflow.color,
          workspaceId: targetWorkspaceId,
          folderId: newFolderId,
          requestId,
        })

        stats.succeeded++
      } catch (error) {
        stats.failed++
        logger.error(`[${requestId}] Error duplicating workflow ${sourceWorkflow.id}:`, error)
      }
    }
  }

  return stats
}
