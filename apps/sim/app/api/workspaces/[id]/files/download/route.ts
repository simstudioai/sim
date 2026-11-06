import { downloadWorkspaceFileItemsContract } from '@/lib/api/contracts/workspace-file-folders'
import {
  defineInternalBinaryRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import {
  internalFileAnalytics,
  internalFileErrorPolicies,
  presentWorkspaceFileArchive,
} from '@/lib/workspace-files/api'
import { downloadWorkspaceFileItems } from '@/lib/workspace-files/application/download-workspace-file-items'

export const GET = defineInternalBinaryRoute({
  contract: downloadWorkspaceFileItemsContract,
  auth: internalSessionAuth,
  headSafe: false,
  operation: downloadWorkspaceFileItems.operation,
  rateLimit: internalRateLimits.none({ reason: 'Internal workspace zip download' }),
  errorPolicy: internalFileErrorPolicies.downloadArchive,
  mapInput: ({ params, query }) => ({
    workspaceId: params.id,
    fileIds: query.fileIds,
    folderIds: query.folderIds,
  }),
  useCase: downloadWorkspaceFileItems,
  onSuccess: internalFileAnalytics.bulkDownloaded,
  present: presentWorkspaceFileArchive,
})
