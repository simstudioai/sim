import { bulkArchiveWorkspaceFileItemsContract } from '@/lib/api/contracts/workspace-file-folders'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalFileAnalytics, internalFileErrorPolicies } from '@/lib/workspace-files/api'
import { archiveWorkspaceFileItemsOperation } from '@/lib/workspace-files/application/archive-workspace-file-items'
import { fileOperations } from '@/lib/workspace-files/application/operations'

export const POST = defineInternalJsonRoute({
  contract: bulkArchiveWorkspaceFileItemsContract,
  auth: internalSessionAuth,
  operation: fileOperations.delete,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing internal bulk archive behavior',
  }),
  errorPolicy: internalFileErrorPolicies.default,
  mapInput: ({ params, body }) => ({
    workspaceId: params.id,
    fileIds: body.fileIds,
    folderIds: body.folderIds,
  }),
  useCase: archiveWorkspaceFileItemsOperation,
  onSuccess: internalFileAnalytics.bulkDeleted,
  present: ({ deletedItems }) => ({ success: true, deletedItems }),
})
