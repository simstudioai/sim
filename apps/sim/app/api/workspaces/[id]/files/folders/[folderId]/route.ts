import {
  deleteWorkspaceFileFolderContract,
  updateWorkspaceFileFolderContract,
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
  deleteWorkspaceFileFolderOperation,
  updateWorkspaceFileFolderOperation,
} from '@/lib/workspace-files/application/workspace-file-folders'

export const PATCH = defineInternalJsonRoute({
  contract: updateWorkspaceFileFolderContract,
  auth: internalSessionAuth,
  operation: fileOperations.updateFolder,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing internal folder update behavior',
  }),
  errorPolicy: internalFileErrorPolicies.default,
  mapInput: ({ params, body }) => ({ workspaceId: params.id, folderId: params.folderId, ...body }),
  useCase: updateWorkspaceFileFolderOperation,
  onSuccess: internalFileAnalytics.folderRenamed,
  present: internalJsonPresenters.withSuccess,
})

export const DELETE = defineInternalJsonRoute({
  contract: deleteWorkspaceFileFolderContract,
  auth: internalSessionAuth,
  operation: fileOperations.deleteFolder,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing internal folder deletion behavior',
  }),
  errorPolicy: internalFileErrorPolicies.default,
  mapInput: ({ params }) => ({ workspaceId: params.id, folderId: params.folderId }),
  useCase: deleteWorkspaceFileFolderOperation,
  onSuccess: internalFileAnalytics.folderDeleted,
  present: internalJsonPresenters.withSuccess,
})
