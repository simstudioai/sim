import {
  downloadWorkspaceFileStreamContract,
  downloadWorkspaceFileUrlContract,
} from '@/lib/api/contracts/workspace-files'
import {
  defineInternalBinaryRoute,
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import {
  internalFileAnalytics,
  internalFileErrorPolicies,
  internalFilePresenters,
} from '@/lib/workspace-files/api'
import {
  downloadWorkspaceFile,
  downloadWorkspaceFileStream,
} from '@/lib/workspace-files/application/download-workspace-file'
import { encodeFilenameForHeader } from '@/app/api/files/utils'

export const dynamic = 'force-dynamic'

export const GET = defineInternalBinaryRoute({
  contract: downloadWorkspaceFileStreamContract,
  auth: internalSessionAuth,
  headSafe: false,
  operation: downloadWorkspaceFileStream.operation,
  rateLimit: internalRateLimits.none({ reason: 'Preserve existing internal download behavior' }),
  errorPolicy: internalFileErrorPolicies.concealResourceAuthorization,
  mapInput: ({ params }) => ({ fileId: params.fileId, assertedWorkspaceId: params.id }),
  useCase: downloadWorkspaceFileStream,
  onSuccess: internalFileAnalytics.downloaded,
  present: ({ file, stream, contentType, contentLength }) => ({
    body: stream,
    contentType,
    contentLength,
    contentDisposition: `attachment; ${encodeFilenameForHeader(file.name)}`,
    headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
  }),
})

/** POST /api/workspaces/[id]/files/[fileId]/download — Create an authenticated serve URL. */
export const POST = defineInternalJsonRoute({
  contract: downloadWorkspaceFileUrlContract,
  auth: internalSessionAuth,
  operation: downloadWorkspaceFile.operation,
  rateLimit: internalRateLimits.none({ reason: 'Preserve existing internal download behavior' }),
  errorPolicy: internalFileErrorPolicies.downloadUrl,
  mapInput: ({ params }) => ({
    fileId: params.fileId,
    assertedWorkspaceId: params.id,
  }),
  useCase: downloadWorkspaceFile,
  onSuccess: internalFileAnalytics.downloaded,
  present: internalFilePresenters.downloadUrl,
})
