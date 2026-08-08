import { restoreWorkspaceFileContract } from '@/lib/api/contracts/workspace-files'
import {
  defineInternalJsonRoute,
  internalFileErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { restoreWorkspaceFileOperation } from '@/lib/workspace-files/application/restore-workspace-file'

export const POST = defineInternalJsonRoute({
  contract: restoreWorkspaceFileContract,
  auth: internalSessionAuth,
  operation: fileOperations.restore,
  rateLimit: internalRateLimits.none({ reason: 'Preserve existing internal restore behavior' }),
  errorPolicy: internalFileErrorPolicy,
  mapInput: ({ params }) => ({ fileId: params.fileId, assertedWorkspaceId: params.id }),
  useCase: restoreWorkspaceFileOperation,
  present: ({ restored }) => ({ success: restored }),
})
