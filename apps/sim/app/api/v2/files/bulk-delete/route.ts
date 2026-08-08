import { v2BulkDeleteFilesContract } from '@/lib/api/contracts/v2/files'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2FileErrorPolicies } from '@/lib/workspace-files/api'
import { archiveWorkspaceFileItemsOperation } from '@/lib/workspace-files/application/archive-workspace-file-items'
import { fileOperations } from '@/lib/workspace-files/application/operations'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const POST = defineV2JsonRoute({
  contract: v2BulkDeleteFilesContract,
  auth: v2ApiKeyAuth,
  operation: fileOperations.delete,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2FileErrorPolicies.default,
  mapInput: ({ body }) => ({ workspaceId: body.workspaceId, fileIds: body.fileIds }),
  useCase: archiveWorkspaceFileItemsOperation,
  present: ({ deletedItems }) => ({ data: { deletedItems: { files: deletedItems.files } } }),
})
