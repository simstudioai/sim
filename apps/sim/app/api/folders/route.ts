import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { workflow, workflowFolder } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, asc, eq, isNotNull, isNull, min } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { createFolderContract, listFoldersContract } from '@/lib/api/contracts'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { captureServerEvent } from '@/lib/posthog/server'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('FoldersAPI')

// GET - Fetch folders for a workspace
export const GET = withRouteHandler(async (request: NextRequest) => {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(listFoldersContract, request, {})
    if (!parsed.success) return parsed.response
    const { workspaceId, scope } = parsed.data.query

    // Check if user has workspace permissions
    const workspacePermission = await getUserEntityPermissions(
      session.user.id,
      'workspace',
      workspaceId
    )

    if (!workspacePermission) {
      return NextResponse.json({ error: 'Access denied to this workspace' }, { status: 403 })
    }

    const archivedFilter =
      scope === 'archived'
        ? isNotNull(workflowFolder.archivedAt)
        : isNull(workflowFolder.archivedAt)

    const folders = await db
      .select()
      .from(workflowFolder)
      .where(and(eq(workflowFolder.workspaceId, workspaceId), archivedFilter))
      .orderBy(asc(workflowFolder.sortOrder), asc(workflowFolder.createdAt))

    return NextResponse.json({ folders })
  } catch (error) {
    logger.error('Error fetching folders:', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})

// POST - Create a new folder
export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(createFolderContract, request, {})
    if (!parsed.success) return parsed.response
    const {
      id: clientId,
      name,
      workspaceId,
      parentId,
      color,
      sortOrder: providedSortOrder,
    } = parsed.data.body

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

    const id = clientId || generateId()

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

    captureServerEvent(
      session.user.id,
      'folder_created',
      { workspace_id: workspaceId },
      { groups: { workspace: workspaceId } }
    )

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
      metadata: {
        name: name.trim(),
        workspaceId,
        parentId: parentId || undefined,
        color: color || '#6B7280',
        sortOrder: newFolder.sortOrder,
      },
      request,
    })

    return NextResponse.json({ folder: newFolder })
  } catch (error) {
    logger.error('Error creating folder:', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})
