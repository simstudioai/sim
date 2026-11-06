import { revertWorkspaceFileVersionContract } from '@/lib/api/contracts/workspace-file-versions'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalFileErrorPolicies } from '@/lib/workspace-files/api'
import { workspaceFileRevisionField } from '@/lib/workspace-files/application/file-revision'
import { revertWorkspaceFileVersion } from '@/lib/workspace-files/application/file-versions'
import { fileOperations } from '@/lib/workspace-files/application/operations'

export const POST = defineInternalJsonRoute({
  contract: revertWorkspaceFileVersionContract,
  auth: internalSessionAuth,
  operation: fileOperations.revertVersion,
  rateLimit: internalRateLimits.user({ bucketName: 'workspace-files.history' }),
  errorPolicy: internalFileErrorPolicies.concealResourceAuthorization,
  mapInput: ({ params, body }) => ({
    assertedWorkspaceId: params.id,
    fileId: params.fileId,
    version: params.version,
    ...body,
  }),
  useCase: revertWorkspaceFileVersion,
  present: ({ file, reverted }) => ({ reverted, ...workspaceFileRevisionField(file) }),
})
