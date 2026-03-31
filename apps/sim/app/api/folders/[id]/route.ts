import { db } from '@sim/db'
import { workflowFolder } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { performDeleteFolder } from '@/lib/workflows/orchestration'
import { checkForCircularReference } from '@/lib/workflows/utils'
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

    const result = await performDeleteFolder({
      folderId: id,
      workspaceId: existingFolder.workspaceId,
      userId: session.user.id,
      folderName: existingFolder.name,
    })

    if (!result.success) {
      const status =
        result.errorCode === 'not_found' ? 404 : result.errorCode === 'validation' ? 400 : 500
      return NextResponse.json({ error: result.error }, { status })
    }

    return NextResponse.json({
      success: true,
      deletedItems: result.deletedItems,
    })
  } catch (error) {
    logger.error('Error deleting folder:', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
