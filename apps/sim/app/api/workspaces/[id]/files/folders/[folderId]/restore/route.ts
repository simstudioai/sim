import { restoreWorkspaceFileFolderContract } from '@/lib/api/contracts/workspace-file-folders'
import {
  defineInternalJsonRoute,
  internalJsonPresenters,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalFileAnalytics, internalFileErrorPolicies } from '@/lib/workspace-files/api'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { restoreWorkspaceFileFolderOperation } from '@/lib/workspace-files/application/workspace-file-folders'

export const POST = defineInternalJsonRoute({
  contract: restoreWorkspaceFileFolderContract,
  auth: internalSessionAuth,
  operation: fileOperations.restoreFolder,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing internal folder restore behavior',
  }),
  errorPolicy: internalFileErrorPolicies.default,
  mapInput: ({ params }) => ({ workspaceId: params.id, folderId: params.folderId }),
  useCase: restoreWorkspaceFileFolderOperation,
  onSuccess: internalFileAnalytics.folderRestored,
  present: internalJsonPresenters.withSuccess,
})
