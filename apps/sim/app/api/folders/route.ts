import { createLogger } from '@sim/logger'
import { assertFolderMutable, FolderLockedError } from '@sim/platform-authz/workflow'
import { type NextRequest, NextResponse } from 'next/server'
import { createFolderContract, listFoldersContract } from '@/lib/api/contracts'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { folderResourceConfig } from '@/lib/folders/config'
import { createFolder } from '@/lib/folders/lifecycle'
import { listFoldersForWorkspace, toFolderApi } from '@/lib/folders/queries'
import { folderMutationStatus } from '@/lib/folders/status'
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
    const { workspaceId, resourceType, scope } = parsed.data.query

    // Check if user has workspace permissions
    const workspacePermission = await getUserEntityPermissions(
      session.user.id,
      'workspace',
      workspaceId
    )

    if (!workspacePermission) {
      return NextResponse.json({ error: 'Access denied to this workspace' }, { status: 403 })
    }

    const folders = await listFoldersForWorkspace(workspaceId, scope, resourceType)

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
      resourceType,
      workspaceId,
      parentId,
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

    // Folder locking is a workflow-only feature; other resource types leave `locked` false.
    if (folderResourceConfig(resourceType).supportsLocking) {
      await assertFolderMutable(parentId ?? null)
    }

    const result = await createFolder({
      id: clientId,
      resourceType,
      userId: session.user.id,
      workspaceId,
      name,
      parentId,
      sortOrder: providedSortOrder,
    })

    if (!result.success || !result.folder) {
      return NextResponse.json(
        { error: result.error },
        { status: folderMutationStatus(result.errorCode) }
      )
    }

    const newFolder = result.folder

    logger.info('Created new folder', {
      id: newFolder.id,
      name,
      resourceType,
      workspaceId,
      parentId,
    })

    captureServerEvent(
      session.user.id,
      'folder_created',
      { workspace_id: workspaceId, resource_type: resourceType },
      { groups: { workspace: workspaceId } }
    )

    return NextResponse.json({ folder: toFolderApi(newFolder) })
  } catch (error) {
    if (error instanceof FolderLockedError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logger.error('Error creating folder:', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})
