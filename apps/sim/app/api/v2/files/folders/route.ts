import {
  v2CreateFileFolderContract,
  v2DeleteFileFolderContract,
  v2ListFileFoldersContract,
  v2RelocateFileFolderContract,
} from '@/lib/api/contracts/v2/files'
import { toFolderPathView } from '@/lib/folders/paths'
import { listActiveFolderRows, loadActiveFolderPathIndex } from '@/lib/folders/queries'
import {
  performCreateWorkspaceFileFolderAtPath,
  performDeleteWorkspaceFileFolderByPath,
  performRelocateWorkspaceFileFolderByPath,
} from '@/lib/workspace-files/orchestration/file-folder-lifecycle'
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
  contract: v2ListFileFoldersContract,
  rateLimitEndpoint: 'files',
  handler: async ({ input, auth: { userId, rateLimit } }) => {
    const { workspaceId, parentPath, search, sortBy, sortOrder } = input.query
    const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'read')
    if (access) return v2WorkspaceAccessError(access)

    const index = await loadActiveFolderPathIndex(workspaceId, 'file')
    const parentId = parentPath === undefined ? undefined : resolveFolderPathId(index, parentPath)
    if (parentPath !== undefined && parentId === undefined) {
      return v2Error('NOT_FOUND', 'Folder not found')
    }
    const rows = await listActiveFolderRows(workspaceId, 'file', {
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
  contract: v2CreateFileFolderContract,
  rateLimitEndpoint: 'files',
  handler: async ({ input, auth: { userId, rateLimit } }) => {
    const { workspaceId, path } = input.body
    const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'write')
    if (access) return v2WorkspaceAccessError(access)
    const result = await performCreateWorkspaceFileFolderAtPath({ workspaceId, userId, path })
    if (!result.success || !result.folder || !result.path) {
      return v2FolderPathMutationError(result.errorCode, result.error ?? 'Failed to create folder')
    }
    return v2Data(
      { folder: toFolderPathView(result.folder, result.path) },
      { rateLimit, status: 201 }
    )
  },
})

export const PATCH = withPublicApiRouteHandler({
  contract: v2RelocateFileFolderContract,
  rateLimitEndpoint: 'files',
  handler: async ({ input, auth: { userId, rateLimit } }) => {
    const { workspaceId, path, destinationPath } = input.body
    const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'write')
    if (access) return v2WorkspaceAccessError(access)
    const result = await performRelocateWorkspaceFileFolderByPath({
      workspaceId,
      userId,
      path,
      destinationPath,
    })
    if (!result.success || !result.folder || !result.path) {
      return v2FolderPathMutationError(result.errorCode, result.error ?? 'Failed to move folder')
    }
    return v2Data({ folder: toFolderPathView(result.folder, result.path) }, { rateLimit })
  },
})

export const DELETE = withPublicApiRouteHandler({
  contract: v2DeleteFileFolderContract,
  rateLimitEndpoint: 'files',
  handler: async ({ input, auth: { userId, rateLimit } }) => {
    const { workspaceId, path, recursive } = input.query
    const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'write')
    if (access) return v2WorkspaceAccessError(access)
    const result = await performDeleteWorkspaceFileFolderByPath({
      workspaceId,
      userId,
      path,
      recursive,
    })
    if (!result.success || !result.deletedItems) {
      return v2FolderPathMutationError(result.errorCode, result.error ?? 'Failed to delete folder')
    }
    return v2Data(
      { path, deleted: true as const, deletedItems: result.deletedItems },
      { rateLimit }
    )
  },
})
