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
