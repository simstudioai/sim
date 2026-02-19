import { db } from '@sim/db'
import { workflow, workflowFolder } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, asc, eq, isNull, min } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { AuditAction, AuditResourceType, recordAudit } from '@/lib/audit/log'
import { getSession } from '@/lib/auth'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

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
    const { name, workspaceId, parentId, color, sortOrder: providedSortOrder } = body

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

    const newFolder = await db.transaction(async (tx) => {
      let sortOrder: number
      if (providedSortOrder !== undefined) {
        sortOrder = providedSortOrder
      } else {
        const folderParentCondition = parentId
          ? eq(workflowFolder.parentId, parentId)
          : isNull(workflowFolder.parentId)
        const workflowParentCondition = parentId
          ? eq(workflow.folderId, parentId)
          : isNull(workflow.folderId)

        const [[folderResult], [workflowResult]] = await Promise.all([
          tx
            .select({ minSortOrder: min(workflowFolder.sortOrder) })
            .from(workflowFolder)
            .where(and(eq(workflowFolder.workspaceId, workspaceId), folderParentCondition)),
          tx
            .select({ minSortOrder: min(workflow.sortOrder) })
            .from(workflow)
            .where(and(eq(workflow.workspaceId, workspaceId), workflowParentCondition)),
        ])

        const minSortOrder = [folderResult?.minSortOrder, workflowResult?.minSortOrder].reduce<
          number | null
        >((currentMin, candidate) => {
          if (candidate == null) return currentMin
          if (currentMin == null) return candidate
          return Math.min(currentMin, candidate)
        }, null)

        sortOrder = minSortOrder != null ? minSortOrder - 1 : 0
      }

      const [folder] = await tx
        .insert(workflowFolder)
        .values({
          id,
          name: name.trim(),
          userId: session.user.id,
          workspaceId,
          parentId: parentId || null,
          color: color || '#6B7280',
          sortOrder,
        })
        .returning()

      return folder
    })

    logger.info('Created new folder:', { id, name, workspaceId, parentId })

    recordAudit({
      workspaceId,
      actorId: session.user.id,
      actorName: session.user.name,
      actorEmail: session.user.email,
      action: AuditAction.FOLDER_CREATED,
      resourceType: AuditResourceType.FOLDER,
      resourceId: id,
      resourceName: name.trim(),
      description: `Created folder "${name.trim()}"`,
      metadata: { name: name.trim() },
      request,
    })

    return NextResponse.json({ folder: newFolder })
  } catch (error) {
    logger.error('Error creating folder:', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
