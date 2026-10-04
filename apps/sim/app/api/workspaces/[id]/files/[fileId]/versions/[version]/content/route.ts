import { downloadWorkspaceFileVersionContract } from '@/lib/api/contracts/workspace-file-versions'
import {
  defineInternalBinaryRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalFileErrorPolicies } from '@/lib/workspace-files/api'
import { downloadWorkspaceFileVersion } from '@/lib/workspace-files/application/file-versions'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { encodeFilenameForHeader } from '@/app/api/files/utils'

export const GET = defineInternalBinaryRoute({
  contract: downloadWorkspaceFileVersionContract,
  auth: internalSessionAuth,
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
  present: ({ file, stream, contentType, contentLength }) => ({
    body: stream,
    contentType,
    contentLength,
    contentDisposition: `attachment; ${encodeFilenameForHeader(file.name)}`,
    headers: new Headers({
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    }),
  }),
})
