import {
  createWorkspaceFileFolderContract,
  listWorkspaceFileFoldersContract,
} from '@/lib/api/contracts/workspace-file-folders'
import {
  defineInternalJsonRoute,
  internalJsonPresenters,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalFileAnalytics, internalFileErrorPolicies } from '@/lib/workspace-files/api'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import {
  createWorkspaceFileFolderOperation,
  listWorkspaceFileFoldersOperation,
} from '@/lib/workspace-files/application/workspace-file-folders'

export const GET = defineInternalJsonRoute({
  contract: listWorkspaceFileFoldersContract,
  auth: internalSessionAuth,
  operation: fileOperations.listFolders,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing internal folder listing behavior',
  }),
  errorPolicy: internalFileErrorPolicies.default,
  mapInput: ({ params, query }) => ({ workspaceId: params.id, scope: query.scope }),
  useCase: listWorkspaceFileFoldersOperation,
  present: internalJsonPresenters.withSuccess,
})

export const POST = defineInternalJsonRoute({
  contract: createWorkspaceFileFolderContract,
  auth: internalSessionAuth,
  operation: fileOperations.createFolder,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing internal folder creation behavior',
  }),
  errorPolicy: internalFileErrorPolicies.default,
  mapInput: ({ params, body }) => ({
    workspaceId: params.id,
    name: body.name,
    parentId: body.parentId,
  }),
  useCase: createWorkspaceFileFolderOperation,
  onSuccess: internalFileAnalytics.folderCreated,
  present: internalJsonPresenters.withSuccess,
})
