import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { getUserEntityPermissions } from '@/lib/permissions/utils'
import { db } from '@/db'
import { workflow, workflowFolder } from '@/db/schema'

const logger = createLogger('FoldersIDAPI')

// PUT - Update a folder
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    const body = await request.json()
    const { name, color, isExpanded, parentId } = body

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

    // Update the folder
    const updates: any = { updatedAt: new Date() }
    if (name !== undefined) updates.name = name.trim()
    if (color !== undefined) updates.color = color
    if (isExpanded !== undefined) updates.isExpanded = isExpanded
    if (parentId !== undefined) updates.parentId = parentId || null

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
