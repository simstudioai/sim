import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import {
  v2CreateTableFolderContract,
  v2DeleteTableFolderContract,
  v2ListTableFoldersContract,
  v2RelocateTableFolderContract,
} from '@/lib/api/contracts/v2/tables'
import { parseRequest } from '@/lib/api/server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  createFolderAtPath,
  deleteFolderByPath,
  relocateFolderByPath,
} from '@/lib/folders/orchestration'
import { listActiveFolderRows, loadActiveFolderPathIndex } from '@/lib/folders/queries'
import { checkRateLimit, resolveWorkspaceAccess } from '@/app/api/v1/middleware'
import {
  resolveFolderPathId,
  toV2PathFolder,
  v2FolderPathMutationError,
} from '@/app/api/v2/lib/folders'
import { v2ApiGateError } from '@/app/api/v2/lib/gate'
import {
  v2CursorList,
  v2Data,
  v2Error,
  v2RateLimitError,
  v2ValidationError,
  v2WorkspaceAccessError,
} from '@/app/api/v2/lib/response'

const logger = createLogger('V2TableFoldersAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const GET = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()
  try {
    const rateLimit = await checkRateLimit(request, 'tables')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)
    const userId = rateLimit.userId!
    const gate = await v2ApiGateError(userId)
    if (gate) return gate
    const parsed = await parseRequest(
      v2ListTableFoldersContract,
      request,
      {},
      {
        validationErrorResponse: v2ValidationError,
      }
    )
    if (!parsed.success) return parsed.response
    const { workspaceId, parentPath, search, sortBy, sortOrder } = parsed.data.query
    const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'read')
    if (access) return v2WorkspaceAccessError(access)

    const index = await loadActiveFolderPathIndex(workspaceId, 'table')
    const parentId = parentPath === undefined ? undefined : resolveFolderPathId(index, parentPath)
    if (parentPath !== undefined && parentId === undefined) {
      return v2Error('NOT_FOUND', 'Folder not found')
    }
    const rows = await listActiveFolderRows(workspaceId, 'table', {
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
  } catch (error) {
    logger.error(`[${requestId}] Error listing table folders`, {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})

export const POST = withRouteHandler(async (request: NextRequest) => {
  const rateLimit = await checkRateLimit(request, 'tables')
  if (!rateLimit.allowed) return v2RateLimitError(rateLimit)
  const userId = rateLimit.userId!
  const gate = await v2ApiGateError(userId)
  if (gate) return gate
  const parsed = await parseRequest(
    v2CreateTableFolderContract,
    request,
    {},
    {
      validationErrorResponse: v2ValidationError,
    }
  )
  if (!parsed.success) return parsed.response
  const { workspaceId, path } = parsed.data.body
  const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'write')
  if (access) return v2WorkspaceAccessError(access)
  const result = await createFolderAtPath({ resourceType: 'table', workspaceId, userId, path })
  if (!result.success || !result.folder) {
    return v2FolderPathMutationError(result.errorCode, result.error ?? 'Failed to create folder')
  }
  const index = await loadActiveFolderPathIndex(workspaceId, 'table')
  return v2Data({ folder: toV2PathFolder(result.folder, index, false) }, { rateLimit, status: 201 })
})

export const PATCH = withRouteHandler(async (request: NextRequest) => {
  const rateLimit = await checkRateLimit(request, 'tables')
  if (!rateLimit.allowed) return v2RateLimitError(rateLimit)
  const userId = rateLimit.userId!
  const gate = await v2ApiGateError(userId)
  if (gate) return gate
  const parsed = await parseRequest(
    v2RelocateTableFolderContract,
    request,
    {},
    {
      validationErrorResponse: v2ValidationError,
    }
  )
  if (!parsed.success) return parsed.response
  const { workspaceId, path, destinationPath } = parsed.data.body
  const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'write')
  if (access) return v2WorkspaceAccessError(access)
  const result = await relocateFolderByPath({
    resourceType: 'table',
    workspaceId,
    userId,
    path,
    destinationPath,
  })
  if (!result.success || !result.folder) {
    return v2FolderPathMutationError(result.errorCode, result.error ?? 'Failed to move folder')
  }
  const index = await loadActiveFolderPathIndex(workspaceId, 'table')
  return v2Data({ folder: toV2PathFolder(result.folder, index, false) }, { rateLimit })
})

export const DELETE = withRouteHandler(async (request: NextRequest) => {
  const rateLimit = await checkRateLimit(request, 'tables')
  if (!rateLimit.allowed) return v2RateLimitError(rateLimit)
  const userId = rateLimit.userId!
  const gate = await v2ApiGateError(userId)
  if (gate) return gate
  const parsed = await parseRequest(
    v2DeleteTableFolderContract,
    request,
    {},
    {
      validationErrorResponse: v2ValidationError,
    }
  )
  if (!parsed.success) return parsed.response
  const { workspaceId, path, recursive } = parsed.data.query
  const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'write')
  if (access) return v2WorkspaceAccessError(access)
  const result = await deleteFolderByPath({
    resourceType: 'table',
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
        tables: result.deletedItems.tables ?? 0,
      },
    },
    { rateLimit }
  )
})
