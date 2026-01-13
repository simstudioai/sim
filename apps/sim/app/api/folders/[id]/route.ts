import { db } from '@sim/db'
import { workflow, workflowFolder } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('FoldersIDAPI')

const updateFolderSchema = z.object({
  name: z.string().optional(),
  color: z.string().optional(),
  isExpanded: z.boolean().optional(),
  parentId: z.string().nullable().optional(),
  sortOrder: z.number().int().min(0).optional(),
})

// PUT - Update a folder
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    const body = await request.json()

    const validationResult = updateFolderSchema.safeParse(body)
    if (!validationResult.success) {
      logger.error('Folder update validation failed:', {
        errors: validationResult.error.errors,
      })
      const errorMessages = validationResult.error.errors
        .map((err) => `${err.path.join('.')}: ${err.message}`)
        .join(', ')
      return NextResponse.json({ error: `Validation failed: ${errorMessages}` }, { status: 400 })
    }

    const { name, color, isExpanded, parentId, sortOrder } = validationResult.data

    // Verify the folder exists
    const existingFolder = await db
      .select()
      .from(workflowFolder)
      .where(eq(workflowFolder.id, id))
      .then((rows) => rows[0])

    if (!existingFolder) {
      return NextResponse.json({ error: 'Folder not found' }, { status: 404 })
    }

    // Check if user has write permissions for the workspace
    const workspacePermission = await getUserEntityPermissions(
      session.user.id,
      'workspace',
      existingFolder.workspaceId
    )

    if (!workspacePermission || workspacePermission === 'read') {
      return NextResponse.json(
        { error: 'Write access required to update folders' },
        { status: 403 }
      )
    }

    // Prevent setting a folder as its own parent or creating circular references
    if (parentId && parentId === id) {
      return NextResponse.json({ error: 'Folder cannot be its own parent' }, { status: 400 })
    }

    // Check for circular references if parentId is provided
    if (parentId) {
      const wouldCreateCycle = await checkForCircularReference(id, parentId)
      if (wouldCreateCycle) {
        return NextResponse.json(
          { error: 'Cannot create circular folder reference' },
          { status: 400 }
        )
      }
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() }
    if (name !== undefined) updates.name = name.trim()
    if (color !== undefined) updates.color = color
    if (isExpanded !== undefined) updates.isExpanded = isExpanded
    if (parentId !== undefined) updates.parentId = parentId || null
    if (sortOrder !== undefined) updates.sortOrder = sortOrder

    const [updatedFolder] = await db
      .update(workflowFolder)
      .set(updates)
      .where(eq(workflowFolder.id, id))
      .returning()

    logger.info('Updated folder:', { id, updates })

    return NextResponse.json({ folder: updatedFolder })
  } catch (error) {
    logger.error('Error updating folder:', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE - Delete a folder and all its contents
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params

    // Verify the folder exists
    const existingFolder = await db
      .select()
      .from(workflowFolder)
      .where(eq(workflowFolder.id, id))
      .then((rows) => rows[0])

    if (!existingFolder) {
      return NextResponse.json({ error: 'Folder not found' }, { status: 404 })
    }

    // Check if user has admin permissions for the workspace (admin-only for deletions)
    const workspacePermission = await getUserEntityPermissions(
      session.user.id,
      'workspace',
      existingFolder.workspaceId
    )

    if (workspacePermission !== 'admin') {
      return NextResponse.json(
        { error: 'Admin access required to delete folders' },
        { status: 403 }
      )
    }

    // Check if deleting this folder would delete the last workflow(s) in the workspace
    const workflowsInFolder = await countWorkflowsInFolderRecursively(
      id,
      existingFolder.workspaceId
    )
    const totalWorkflowsInWorkspace = await db
      .select({ id: workflow.id })
      .from(workflow)
      .where(eq(workflow.workspaceId, existingFolder.workspaceId))

    if (workflowsInFolder > 0 && workflowsInFolder >= totalWorkflowsInWorkspace.length) {
      return NextResponse.json(
        { error: 'Cannot delete folder containing the only workflow(s) in the workspace' },
        { status: 400 }
      )
    }

    // Recursively delete folder and all its contents
    const deletionStats = await deleteFolderRecursively(id, existingFolder.workspaceId)

    logger.info('Deleted folder and all contents:', {
      id,
      deletionStats,
    })

    return NextResponse.json({
      success: true,
      deletedItems: deletionStats,
    })
  } catch (error) {
    logger.error('Error deleting folder:', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Helper function to recursively delete a folder and all its contents
async function deleteFolderRecursively(
  folderId: string,
  workspaceId: string
): Promise<{ folders: number; workflows: number }> {
  const stats = { folders: 0, workflows: 0 }

  // Get all child folders first (workspace-scoped, not user-scoped)
  const childFolders = await db
    .select({ id: workflowFolder.id })
    .from(workflowFolder)
    .where(and(eq(workflowFolder.parentId, folderId), eq(workflowFolder.workspaceId, workspaceId)))

  // Recursively delete child folders
  for (const childFolder of childFolders) {
    const childStats = await deleteFolderRecursively(childFolder.id, workspaceId)
    stats.folders += childStats.folders
    stats.workflows += childStats.workflows
  }

  // Delete all workflows in this folder (workspace-scoped, not user-scoped)
  // The database cascade will handle deleting related workflow_blocks, workflow_edges, workflow_subflows
  const workflowsInFolder = await db
    .select({ id: workflow.id })
    .from(workflow)
    .where(and(eq(workflow.folderId, folderId), eq(workflow.workspaceId, workspaceId)))

  if (workflowsInFolder.length > 0) {
    await db
      .delete(workflow)
      .where(and(eq(workflow.folderId, folderId), eq(workflow.workspaceId, workspaceId)))

    stats.workflows += workflowsInFolder.length
  }

  // Delete this folder
  await db.delete(workflowFolder).where(eq(workflowFolder.id, folderId))

  stats.folders += 1

  return stats
}

/**
 * Counts the number of workflows in a folder and all its subfolders recursively.
 */
async function countWorkflowsInFolderRecursively(
  folderId: string,
  workspaceId: string
): Promise<number> {
  let count = 0

  const workflowsInFolder = await db
    .select({ id: workflow.id })
    .from(workflow)
    .where(and(eq(workflow.folderId, folderId), eq(workflow.workspaceId, workspaceId)))

  count += workflowsInFolder.length

  const childFolders = await db
    .select({ id: workflowFolder.id })
    .from(workflowFolder)
    .where(and(eq(workflowFolder.parentId, folderId), eq(workflowFolder.workspaceId, workspaceId)))

  for (const childFolder of childFolders) {
    count += await countWorkflowsInFolderRecursively(childFolder.id, workspaceId)
  }

  return count
}

// Helper function to check for circular references
async function checkForCircularReference(folderId: string, parentId: string): Promise<boolean> {
  let currentParentId: string | null = parentId
  const visited = new Set<string>()

  while (currentParentId) {
    if (visited.has(currentParentId)) {
      return true // Circular reference detected
    }

    if (currentParentId === folderId) {
      return true // Would create a cycle
    }

    visited.add(currentParentId)

    // Get the parent of the current parent
    const parent: { parentId: string | null } | undefined = await db
      .select({ parentId: workflowFolder.parentId })
      .from(workflowFolder)
      .where(eq(workflowFolder.id, currentParentId))
      .then((rows) => rows[0])

    currentParentId = parent?.parentId || null
  }

  return false
}
