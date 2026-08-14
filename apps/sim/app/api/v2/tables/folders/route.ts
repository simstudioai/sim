import {
  v2CreateTableFolderContract,
  v2DeleteTableFolderContract,
  v2ListTableFoldersContract,
  v2RelocateTableFolderContract,
} from '@/lib/api/contracts/v2/tables'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2TableErrorPolicies } from '@/lib/table/api'
import {
  createTableFolderUseCase,
  deleteTableFolderUseCase,
  listTableFoldersUseCase,
  updateTableFolderUseCase,
} from '@/lib/table/application/folders'
import { tableOperations } from '@/lib/table/application/operations'
import { toV2PathFolder } from '@/app/api/v2/lib/folders'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const GET = defineV2JsonRoute({
  contract: v2ListTableFoldersContract,
  operation: tableOperations.listFolders,
  useCase: listTableFoldersUseCase,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2TableErrorPolicies.default,
  mapInput: ({ query }) => query,
  present: ({ folders, index }) => ({
    data: folders.map((folder) => toV2PathFolder(folder, index, false)),
    nextCursor: null,
  }),
})

export const POST = defineV2JsonRoute({
  contract: v2CreateTableFolderContract,
  operation: tableOperations.createFolder,
  useCase: createTableFolderUseCase,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2TableErrorPolicies.default,
  mapInput: ({ body }) => body,
  present: ({ folder, index }) => ({ data: toV2PathFolder(folder, index, false) }),
})

export const PATCH = defineV2JsonRoute({
  contract: v2RelocateTableFolderContract,
  operation: tableOperations.updateFolder,
  useCase: updateTableFolderUseCase,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2TableErrorPolicies.default,
  mapInput: ({ body }) => body,
  present: ({ folder, index }) => ({ data: toV2PathFolder(folder, index, false) }),
})

export const DELETE = defineV2JsonRoute({
  contract: v2DeleteTableFolderContract,
  operation: tableOperations.deleteFolder,
  useCase: deleteTableFolderUseCase,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2TableErrorPolicies.default,
  mapInput: ({ query }) => query,
  present: ({ path, deleted, deletedItems }) => ({ data: { path, deleted, deletedItems } }),
})
