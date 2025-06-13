import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { workflow, workflowFolder } from '@/db/schema'

const logger = createLogger('FolderAPI')

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

    // Verify the folder exists and belongs to the user
    const existingFolder = await db
      .select()
      .from(workflowFolder)
      .where(and(eq(workflowFolder.id, id), eq(workflowFolder.userId, session.user.id)))
      .then((rows) => rows[0])

    if (!existingFolder) {
      return NextResponse.json({ error: 'Folder not found' }, { status: 404 })
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

// DELETE - Delete a folder
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
    const { searchParams } = new URL(request.url)
    const moveWorkflowsTo = searchParams.get('moveWorkflowsTo') // Optional: move workflows to another folder

    // Verify the folder exists and belongs to the user
    const existingFolder = await db
      .select()
      .from(workflowFolder)
      .where(and(eq(workflowFolder.id, id), eq(workflowFolder.userId, session.user.id)))
      .then((rows) => rows[0])

    if (!existingFolder) {
      return NextResponse.json({ error: 'Folder not found' }, { status: 404 })
    }

    // Check if folder has child folders
    const childFolders = await db
      .select({ id: workflowFolder.id })
      .from(workflowFolder)
      .where(eq(workflowFolder.parentId, id))

    // Check if folder has workflows
    const workflowsInFolder = await db
      .select({ id: workflow.id })
      .from(workflow)
      .where(eq(workflow.folderId, id))

    // Handle child folders - move them to parent or root
    if (childFolders.length > 0) {
      await db
        .update(workflowFolder)
        .set({
          parentId: existingFolder.parentId, // Move to the parent of the deleted folder
          updatedAt: new Date(),
        })
        .where(eq(workflowFolder.parentId, id))
    }

    // Handle workflows in the folder
    if (workflowsInFolder.length > 0) {
      const newFolderId = moveWorkflowsTo || null // Move to specified folder or root
      await db
        .update(workflow)
        .set({
          folderId: newFolderId,
          updatedAt: new Date(),
        })
        .where(eq(workflow.folderId, id))
    }

    // Delete the folder
    await db.delete(workflowFolder).where(eq(workflowFolder.id, id))

    logger.info('Deleted folder:', {
      id,
      childFoldersCount: childFolders.length,
      workflowsCount: workflowsInFolder.length,
      movedWorkflowsTo: moveWorkflowsTo,
    })

    return NextResponse.json({
      success: true,
      movedItems: {
        childFolders: childFolders.length,
        workflows: workflowsInFolder.length,
      },
    })
  } catch (error) {
    logger.error('Error deleting folder:', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
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
