import {
  v2CreateKnowledgeFolderContract,
  v2DeleteKnowledgeFolderContract,
  v2ListKnowledgeFoldersContract,
  v2RelocateKnowledgeFolderContract,
} from '@/lib/api/contracts/v2/knowledge'
import {
  createFolderAtPath,
  deleteFolderByPath,
  relocateFolderByPath,
} from '@/lib/folders/orchestration'
import { listActiveFolderRows, loadActiveFolderPathIndex } from '@/lib/folders/queries'
import { withPublicApiRouteHandler } from '@/app/api/public-api-route-handler'
import { resolveWorkspaceAccess } from '@/app/api/v1/middleware'
import {
  resolveFolderPathId,
  toV2PathFolder,
  v2FolderPathMutationError,
} from '@/app/api/v2/lib/folders'
import { v2CursorList, v2Data, v2Error, v2WorkspaceAccessError } from '@/app/api/v2/lib/response'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const GET = withPublicApiRouteHandler({
  contract: v2ListKnowledgeFoldersContract,
  rateLimitEndpoint: 'knowledge',
  handler: async ({ input, auth: { userId, rateLimit } }) => {
    const { workspaceId, parentPath, search, sortBy, sortOrder } = input.query
    const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'read')
    if (access) return v2WorkspaceAccessError(access)

    const index = await loadActiveFolderPathIndex(workspaceId, 'knowledge_base')
    const parentId = parentPath === undefined ? undefined : resolveFolderPathId(index, parentPath)
    if (parentPath !== undefined && parentId === undefined) {
      return v2Error('NOT_FOUND', 'Folder not found')
    }
    const rows = await listActiveFolderRows(workspaceId, 'knowledge_base', {
      parentId,
      search,
      sortBy,
      sortOrder,
    })
    return v2CursorList(
      rows.map((row) => toV2PathFolder(row, index, false)),
      null,
      { rateLimit }
    )
  },
})

export const POST = withPublicApiRouteHandler({
  contract: v2CreateKnowledgeFolderContract,
  rateLimitEndpoint: 'knowledge',
  handler: async ({ input, auth: { userId, rateLimit } }) => {
    const { workspaceId, path } = input.body
    const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'write')
    if (access) return v2WorkspaceAccessError(access)
    const result = await createFolderAtPath({
      resourceType: 'knowledge_base',
      workspaceId,
      userId,
      path,
    })
    if (!result.success || !result.folder) {
      return v2FolderPathMutationError(result.errorCode, result.error ?? 'Failed to create folder')
    }
    const index = await loadActiveFolderPathIndex(workspaceId, 'knowledge_base')
    return v2Data(
      { folder: toV2PathFolder(result.folder, index, false) },
      { rateLimit, status: 201 }
    )
  },
})

export const PATCH = withPublicApiRouteHandler({
  contract: v2RelocateKnowledgeFolderContract,
  rateLimitEndpoint: 'knowledge',
  handler: async ({ input, auth: { userId, rateLimit } }) => {
    const { workspaceId, path, destinationPath } = input.body
    const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'write')
    if (access) return v2WorkspaceAccessError(access)
    const result = await relocateFolderByPath({
      resourceType: 'knowledge_base',
      workspaceId,
      userId,
      path,
      destinationPath,
    })
    if (!result.success || !result.folder) {
      return v2FolderPathMutationError(result.errorCode, result.error ?? 'Failed to move folder')
    }
    const index = await loadActiveFolderPathIndex(workspaceId, 'knowledge_base')
    return v2Data({ folder: toV2PathFolder(result.folder, index, false) }, { rateLimit })
  },
})

export const DELETE = withPublicApiRouteHandler({
  contract: v2DeleteKnowledgeFolderContract,
  rateLimitEndpoint: 'knowledge',
  handler: async ({ input, auth: { userId, rateLimit } }) => {
    const { workspaceId, path, recursive } = input.query
    const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'write')
    if (access) return v2WorkspaceAccessError(access)
    const result = await deleteFolderByPath({
      resourceType: 'knowledge_base',
      workspaceId,
      userId,
      path,
      recursive,
    })
    if (!result.success || !result.deletedItems) {
      return v2FolderPathMutationError(result.errorCode, result.error ?? 'Failed to delete folder')
    }
    return v2Data(
      {
        path,
        deleted: true as const,
        deletedItems: {
          folders: result.deletedItems.folders,
          knowledgeBases: result.deletedItems.knowledgeBases ?? 0,
        },
      },
      { rateLimit }
    )
  },
})
