import { createLogger } from '@sim/logger'
import { assertFolderMutable, FolderLockedError } from '@sim/platform-authz/workflow'
import { type NextRequest, NextResponse } from 'next/server'
import { createFolderContract, listFoldersContract } from '@/lib/api/contracts'
import { parseRequest } from '@/lib/api/server'
import {
  defineInternalJsonRoute,
  internalErrorResponse,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { listWorkspaceFoldersUseCase } from '@/lib/folders/application/list-folders'
import { folderOperations } from '@/lib/folders/application/operations'
import { createFolder } from '@/lib/folders/orchestration'
import { toFolderApi } from '@/lib/folders/queries'
import { folderResourceSupportsLocking } from '@/lib/folders/resource-traits'
import { folderMutationStatus } from '@/lib/folders/status'
import { captureServerEvent } from '@/lib/posthog/server'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('FoldersAPI')

export const GET = defineInternalJsonRoute({
  contract: listFoldersContract,
  auth: internalSessionAuth,
  operation: folderOperations.list,
  rateLimit: internalRateLimits.none({ reason: 'Preserve existing folder list behavior' }),
  errorPolicy: {
    ...internalOrchestrationErrorPolicy,
    unhandled: () => internalErrorResponse(500, { error: 'Internal server error' }),
  },
  mapInput: ({ query }) => ({
    workspaceId: query.workspaceId,
    resourceType: query.resourceType,
    scope: query.scope,
  }),
  useCase: listWorkspaceFoldersUseCase,
  present: (folders) => ({ folders }),
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
    if (folderResourceSupportsLocking(resourceType)) {
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
