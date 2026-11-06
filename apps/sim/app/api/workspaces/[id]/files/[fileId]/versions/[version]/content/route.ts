import { downloadWorkspaceFileVersionContract } from '@/lib/api/contracts/workspace-file-versions'
import {
  defineInternalBinaryRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { FILE_CACHE_CONTROL, presentFileDelivery } from '@/lib/uploads/server/delivery'
import { internalFileErrorPolicies } from '@/lib/workspace-files/api'
import { downloadWorkspaceFileVersion } from '@/lib/workspace-files/application/file-versions'
import { fileOperations } from '@/lib/workspace-files/application/operations'

export const GET = defineInternalBinaryRoute({
  contract: downloadWorkspaceFileVersionContract,
  auth: internalSessionAuth,
  headSafe: false,
  operation: fileOperations.downloadVersion,
  rateLimit: internalRateLimits.none({
    reason: 'Authenticated historical downloads follow the workspace binary delivery policy',
  }),
  errorPolicy: internalFileErrorPolicies.concealResourceAuthorization,
  mapInput: ({ params }) => ({
    assertedWorkspaceId: params.id,
    fileId: params.fileId,
    version: params.version,
  }),
  useCase: downloadWorkspaceFileVersion,
  present: ({ file, stream, contentType, contentLength }) =>
    presentFileDelivery({
      body: stream,
      filename: file.name,
      contentType,
      contentLength,
      attachment: true,
      cacheControl: FILE_CACHE_CONTROL.noStore,
    }),
})
