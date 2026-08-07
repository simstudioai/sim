import { assertFolderMutable, FolderLockedError } from '@sim/platform-authz/workflow'
import {
  type V2WorkflowListItem,
  v2CreateWorkflowContract,
  v2ListWorkflowsContract,
} from '@/lib/api/contracts/v2/workflows'
import { loadActiveFolderPathIndex } from '@/lib/folders/queries'
import { performCreateWorkflow } from '@/lib/workflows/orchestration'
import { InvalidWorkflowListCursorError, listWorkspaceWorkflows } from '@/lib/workflows/queries'
import { withPublicApiRouteHandler } from '@/app/api/public-api-route-handler'
import { resolveWorkspaceAccess } from '@/app/api/v1/middleware'
import {
  folderPathForId,
  resolveFolderPathId,
  resolveFolderPathIdentity,
} from '@/app/api/v2/lib/folders'
import {
  cursorSortKey,
  decodeSortedCursor,
  encodeSortedCursor,
  v2CursorList,
  v2CursorSortError,
  v2Data,
  v2Error,
  v2ErrorForOrchestration,
  v2WorkspaceAccessError,
} from '@/app/api/v2/lib/response'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const GET = withPublicApiRouteHandler({
  contract: v2ListWorkflowsContract,
  rateLimitEndpoint: 'workflows',
  handler: async ({ input, auth: { userId, rateLimit } }) => {
    const params = input.query

    const access = await resolveWorkspaceAccess(rateLimit, userId, params.workspaceId, 'read')
    if (access) return v2WorkspaceAccessError(access)

    const folderIndex = await loadActiveFolderPathIndex(params.workspaceId, 'workflow')
    const folderId =
      params.folderPath === undefined
        ? undefined
        : resolveFolderPathId(folderIndex, params.folderPath)
    if (params.folderPath !== undefined && folderId === undefined) {
      return v2Error('NOT_FOUND', 'Folder not found')
    }

    const sortKey = cursorSortKey(params.sortBy, params.sortOrder)
    const decoded = decodeSortedCursor(params.cursor, sortKey)
    if (decoded.status === 'invalid') return v2CursorSortError()

    let result
    try {
      result = await listWorkspaceWorkflows({
        workspaceId: params.workspaceId,
        folderId,
        deployedOnly: params.deployedOnly,
        search: params.search,
        sortBy: params.sortBy,
        sortOrder: params.sortOrder,
        cursorKeys: decoded.status === 'ok' ? decoded.keys : undefined,
        limit: params.limit,
      })
    } catch (error) {
      if (error instanceof InvalidWorkflowListCursorError) return v2CursorSortError()
      throw error
    }

    const nextCursor = result.nextCursorKeys
      ? encodeSortedCursor(sortKey, result.nextCursorKeys)
      : null

    const formatted: V2WorkflowListItem[] = result.data.map((w) => ({
      id: w.id,
      name: w.name,
      description: w.description,
      folderPath: folderPathForId(folderIndex, w.folderId),
      workspaceId: w.workspaceId ?? params.workspaceId,
      isDeployed: w.isDeployed,
      deployedAt: w.deployedAt?.toISOString() ?? null,
      runCount: w.runCount,
      lastRunAt: w.lastRunAt?.toISOString() ?? null,
      createdAt: w.createdAt.toISOString(),
      updatedAt: w.updatedAt.toISOString(),
    }))

    return v2CursorList(formatted, nextCursor, { rateLimit })
  },
})

/** POST /api/v2/workflows — Create an empty workflow in a workspace. */
export const POST = withPublicApiRouteHandler({
  contract: v2CreateWorkflowContract,
  rateLimitEndpoint: 'workflows',
  handler: async ({ input, auth: { requestId, userId, rateLimit } }) => {
    try {
      const { workspaceId, name, description, folderPath } = input.body

      const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'write')
      if (access) return v2WorkspaceAccessError(access)

      const resolution = await resolveFolderPathIdentity({
        workspaceId,
        resourceType: 'workflow',
        path: folderPath ?? '/',
      })
      if (!resolution.found) return v2Error('NOT_FOUND', 'Folder not found')

      await assertFolderMutable(resolution.folderId)
      const result = await performCreateWorkflow({
        userId,
        workspaceId,
        name,
        description,
        folderId: resolution.folderId,
        requestId,
      })

      if (!result.success || !result.workflow) {
        return v2ErrorForOrchestration(
          result.errorCode,
          result.error ?? 'Failed to create workflow'
        )
      }

      const created = result.workflow
      const item: V2WorkflowListItem = {
        id: created.id,
        name: created.name,
        description: created.description ?? null,
        folderPath: folderPathForId(resolution.index, created.folderId),
        workspaceId: created.workspaceId,
        isDeployed: false,
        deployedAt: null,
        runCount: 0,
        lastRunAt: null,
        createdAt: created.createdAt.toISOString(),
        updatedAt: created.updatedAt.toISOString(),
      }

      return v2Data(item, { rateLimit, status: 201 })
    } catch (error) {
      if (error instanceof FolderLockedError) return v2Error('LOCKED', error.message)

      throw error
    }
  },
})
