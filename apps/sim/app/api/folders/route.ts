import { db } from '@sim/db'
import { workflowFolder } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, asc, eq, isNotNull, isNull } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { createFolderContract, listFoldersContract } from '@/lib/api/contracts'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { captureServerEvent } from '@/lib/posthog/server'
import { performCreateFolder } from '@/lib/workflows/orchestration'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('FoldersAPI')

function folderMutationStatus(errorCode: string | undefined): number {
  if (errorCode === 'validation') return 400
  if (errorCode === 'conflict') return 409
  if (errorCode === 'not_found') return 404
  return 500
}

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

    const result = await performCreateFolder({
      id: clientId,
      userId: session.user.id,
      workspaceId,
      name,
      parentId,
      color,
      sortOrder: providedSortOrder,
    })

    if (!result.success || !result.folder) {
      return NextResponse.json(
        { error: result.error },
        { status: folderMutationStatus(result.errorCode) }
      )
    }

    const newFolder = result.folder

    logger.info('Created new folder:', { id: newFolder.id, name, workspaceId, parentId })

    captureServerEvent(
      session.user.id,
      'folder_created',
      { workspace_id: workspaceId },
      { groups: { workspace: workspaceId } }
    )

    return NextResponse.json({ folder: newFolder })
  } catch (error) {
    logger.error('Error creating folder:', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})
