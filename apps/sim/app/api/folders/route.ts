import { db } from '@sim/db'
import { workflowFolder } from '@sim/db/schema'
import { and, asc, desc, eq, isNull } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { getUserEntityPermissions } from '@/lib/permissions/utils'

const logger = createLogger('FoldersAPI')

// GET - Fetch folders for a workspace
export async function GET(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const workspaceId = searchParams.get('workspaceId')

    if (!workspaceId) {
      return NextResponse.json({ error: 'Workspace ID is required' }, { status: 400 })
    }

    // Check if user has workspace permissions
    const workspacePermission = await getUserEntityPermissions(
      session.user.id,
      'workspace',
      workspaceId
    )

    if (!workspacePermission) {
      return NextResponse.json({ error: 'Access denied to this workspace' }, { status: 403 })
    }

    // If user has workspace permissions, fetch ALL folders in the workspace
    // This allows shared workspace members to see folders created by other users
    const folders = await db
      .select()
      .from(workflowFolder)
      .where(eq(workflowFolder.workspaceId, workspaceId))
      .orderBy(asc(workflowFolder.sortOrder), asc(workflowFolder.createdAt))

    return NextResponse.json({ folders })
  } catch (error) {
    logger.error('Error fetching folders:', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST - Create a new folder
export async function POST(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { name, workspaceId, parentId, color } = body

    if (!name || !workspaceId) {
      return NextResponse.json({ error: 'Name and workspace ID are required' }, { status: 400 })
    }

    // Check if user has workspace permissions (at least 'write' access to create folders)
    const workspacePermission = await getUserEntityPermissions(
      session.user.id,
      'workspace',
      workspaceId
    )

    if (!workspacePermission || workspacePermission === 'read') {
      return NextResponse.json(
        { error: 'Write or Admin access required to create folders' },
        { status: 403 }
      )
    }

    // Generate a new ID
    const id = crypto.randomUUID()

    // Use transaction to ensure sortOrder consistency
    const newFolder = await db.transaction(async (tx) => {
      // Get the next sort order for the parent (or root level)
      // Consider all folders in the workspace, not just those created by current user
      const existingFolders = await tx
        .select({ sortOrder: workflowFolder.sortOrder })
        .from(workflowFolder)
        .where(
          and(
            eq(workflowFolder.workspaceId, workspaceId),
            parentId ? eq(workflowFolder.parentId, parentId) : isNull(workflowFolder.parentId)
          )
        )
        .orderBy(desc(workflowFolder.sortOrder))
        .limit(1)

      const nextSortOrder = existingFolders.length > 0 ? existingFolders[0].sortOrder + 1 : 0

      // Insert the new folder within the same transaction
      const [folder] = await tx
        .insert(workflowFolder)
        .values({
          id,
          name: name.trim(),
          userId: session.user.id,
          workspaceId,
          parentId: parentId || null,
          color: color || '#6B7280',
          sortOrder: nextSortOrder,
        })
        .returning()

      return folder
    })

    logger.info('Created new folder:', { id, name, workspaceId, parentId })

    return NextResponse.json({ folder: newFolder })
  } catch (error) {
    logger.error('Error creating folder:', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
