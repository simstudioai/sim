import { updateWorkspaceFileDimensionsContract } from '@/lib/api/contracts/workspace-files'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalFileErrorPolicies } from '@/lib/workspace-files/api'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { updateWorkspaceFileDimensionsOperation } from '@/lib/workspace-files/application/update-workspace-file-dimensions'

export const PATCH = defineInternalJsonRoute({
  contract: updateWorkspaceFileDimensionsContract,
  auth: internalSessionAuth,
  operation: fileOperations.updateMetadata,
  rateLimit: internalRateLimits.none({ reason: 'Preserve existing internal dimensions behavior' }),
  errorPolicy: internalFileErrorPolicies.default,
  mapInput: ({ params, body }) => ({
    fileId: params.fileId,
    assertedWorkspaceId: params.id,
    key: body.key,
    width: body.width,
    height: body.height,
  }),
  useCase: updateWorkspaceFileDimensionsOperation,
})
