import {
  v2CreateKnowledgeFolderContract,
  v2DeleteKnowledgeFolderContract,
  v2ListKnowledgeFoldersContract,
  v2RelocateKnowledgeFolderContract,
} from '@/lib/api/contracts/v2/knowledge'
import {
  defineV2JsonRoute,
  v2ApiKeyAuth,
  v2OrchestrationErrorPolicy,
  v2RateLimits,
} from '@/lib/api/server/routes'
import { toFolderPathView } from '@/lib/folders/paths'
import {
  createKnowledgeFolder,
  deleteKnowledgeFolder,
  listKnowledgeFolders,
  relocateKnowledgeFolder,
} from '@/lib/knowledge/application/folders'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const GET = defineV2JsonRoute({
  contract: v2ListKnowledgeFoldersContract,
  auth: v2ApiKeyAuth,
  operation: knowledgeOperations.listFolders,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrchestrationErrorPolicy,
  mapInput: ({ query }) => ({
    workspaceId: query.workspaceId,
    parentPath: query.parentPath,
    search: query.search,
    sortBy: query.sortBy,
    sortOrder: query.sortOrder,
  }),
  useCase: listKnowledgeFolders,
  present: ({ folders }) => ({
    data: folders.map((folder) => toFolderPathView(folder, folder.path)),
    nextCursor: null,
  }),
})

export const POST = defineV2JsonRoute({
  contract: v2CreateKnowledgeFolderContract,
  auth: v2ApiKeyAuth,
  operation: knowledgeOperations.createFolder,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrchestrationErrorPolicy,
  mapInput: ({ body }) => ({ workspaceId: body.workspaceId, path: body.path, source: 'api' }),
  useCase: createKnowledgeFolder,
  present: ({ folder }) => ({ data: toFolderPathView(folder, folder.path) }),
})

export const PATCH = defineV2JsonRoute({
  contract: v2RelocateKnowledgeFolderContract,
  auth: v2ApiKeyAuth,
  operation: knowledgeOperations.relocateFolder,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrchestrationErrorPolicy,
  mapInput: ({ body }) => ({
    workspaceId: body.workspaceId,
    path: body.path,
    destinationPath: body.destinationPath,
    source: 'api',
  }),
  useCase: relocateKnowledgeFolder,
  present: ({ folder }) => ({ data: toFolderPathView(folder, folder.path) }),
})

export const DELETE = defineV2JsonRoute({
  contract: v2DeleteKnowledgeFolderContract,
  auth: v2ApiKeyAuth,
  operation: knowledgeOperations.deleteFolder,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrchestrationErrorPolicy,
  mapInput: ({ query }) => ({
    workspaceId: query.workspaceId,
    path: query.path,
    recursive: query.recursive,
    source: 'api',
  }),
  useCase: deleteKnowledgeFolder,
  present: ({ path, deletedItems }) => ({
    data: {
      path,
      deleted: true as const,
      deletedItems: {
        folders: deletedItems.folders,
        knowledgeBases: deletedItems.knowledgeBases ?? 0,
      },
    },
  }),
})
