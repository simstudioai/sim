import {
  v2CreateFileFolderContract,
  v2DeleteFileFolderContract,
  v2ListFileFoldersContract,
  v2RelocateFileFolderContract,
} from '@/lib/api/contracts/v2/files'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { buildFolderPath, parentFolderPath, parseFolderPath } from '@/lib/folders/paths'
import { v2FileErrorPolicies } from '@/lib/workspace-files/api'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import {
  createWorkspaceFileFolderOperation,
  deleteWorkspaceFileFolderOperation,
  listWorkspaceFileFoldersOperation,
  updateWorkspaceFileFolderOperation,
} from '@/lib/workspace-files/application/workspace-file-folders'
import { parseWorkspaceFileFolderDisplayPath } from '@/lib/workspace-files/folder-display-path'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function toV2Folder(folder: { name: string; path: string; createdAt: Date; updatedAt: Date }) {
  const segments = folder.path.startsWith('/')
    ? parseFolderPath(folder.path)
    : parseWorkspaceFileFolderDisplayPath(folder.path)
  if (segments.at(-1) !== folder.name) {
    throw new Error('Workspace file folder path does not match its folder name')
  }
  const path = buildFolderPath(segments)
  return {
    name: folder.name,
    path,
    parentPath: parentFolderPath(path),
    createdAt: folder.createdAt.toISOString(),
    updatedAt: folder.updatedAt.toISOString(),
  }
}

export const GET = defineV2JsonRoute({
  contract: v2ListFileFoldersContract,
  auth: v2ApiKeyAuth,
  operation: fileOperations.listFolders,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2FileErrorPolicies.default,
  mapInput: ({ query }) => ({
    workspaceId: query.workspaceId,
    parentPath: query.parentPath,
    search: query.search,
    sortBy: query.sortBy,
    sortOrder: query.sortOrder,
  }),
  useCase: listWorkspaceFileFoldersOperation,
  present: ({ folders }) => ({ data: folders.map(toV2Folder), nextCursor: null }),
})

export const POST = defineV2JsonRoute({
  contract: v2CreateFileFolderContract,
  auth: v2ApiKeyAuth,
  operation: fileOperations.createFolder,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2FileErrorPolicies.default,
  mapInput: ({ body }) => ({ workspaceId: body.workspaceId, path: body.path }),
  useCase: createWorkspaceFileFolderOperation,
  present: ({ folder }) => ({ data: toV2Folder(folder) }),
})

export const PATCH = defineV2JsonRoute({
  contract: v2RelocateFileFolderContract,
  auth: v2ApiKeyAuth,
  operation: fileOperations.updateFolder,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2FileErrorPolicies.default,
  mapInput: ({ body }) => ({
    workspaceId: body.workspaceId,
    path: body.path,
    destinationPath: body.destinationPath,
  }),
  useCase: updateWorkspaceFileFolderOperation,
  present: ({ folder }) => ({ data: toV2Folder(folder) }),
})

export const DELETE = defineV2JsonRoute({
  contract: v2DeleteFileFolderContract,
  auth: v2ApiKeyAuth,
  operation: fileOperations.deleteFolder,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2FileErrorPolicies.default,
  mapInput: ({ query }) => ({
    workspaceId: query.workspaceId,
    path: query.path,
    recursive: query.recursive,
  }),
  useCase: deleteWorkspaceFileFolderOperation,
  present: ({ deletedItems, path }) => ({
    data: {
      path: path ?? '/',
      deleted: true as const,
      deletedItems,
    },
  }),
})
