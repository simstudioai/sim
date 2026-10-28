import { getInlineWorkspaceFileContract } from '@/lib/api/contracts/workspace-files'
import {
  defineInternalBinaryRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { presentFileDelivery, workspaceFileCacheControl } from '@/lib/uploads/server/delivery'
import { internalFileErrorPolicies } from '@/lib/workspace-files/api'
import { readWorkspaceInlineFile } from '@/lib/workspace-files/application/read-workspace-inline-file'

export const dynamic = 'force-dynamic'

/**
 * GET /api/workspaces/[id]/files/inline?key=<cloudKey>|fileId=<id>
 *
 * Serves an embedded workspace image. A URL naming the exact storage object that was streamed is
 * cached immutably (see {@link ReadWorkspaceInlineFileResult.contentAddressed}): a content write
 * never rewrites an object, and every document render asks for each image at least twice (the
 * editor's DOM, then its React node view) across two editor mounts, so revalidating re-downloaded
 * every image on every open. A URL naming the file, whose bytes move as it is edited, revalidates.
 */
export const GET = defineInternalBinaryRoute({
  contract: getInlineWorkspaceFileContract,
  auth: internalSessionAuth,
  headSafe: false,
  operation: readWorkspaceInlineFile.operation,
  rateLimit: internalRateLimits.none({ reason: 'Internal workspace inline image delivery' }),
  errorPolicy: internalFileErrorPolicies.inline,
  mapInput: ({ params, query }) => ({
    workspaceId: params.id,
    key: query.key,
    fileId: query.fileId,
  }),
  useCase: readWorkspaceInlineFile,
  present: ({ file, stream, contentAddressed }) =>
    presentFileDelivery({
      body: stream,
      filename: file.name,
      contentType: file.type,
      contentLength: file.size,
      cacheControl: workspaceFileCacheControl(contentAddressed),
    }),
})
