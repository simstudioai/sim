import { v2MoveFileItemsContract } from '@/lib/api/contracts/v2/files'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2FileErrorPolicies } from '@/lib/workspace-files/api'
import { moveWorkspaceFileItemsOperation } from '@/lib/workspace-files/application/move-workspace-file-items'
import { fileOperations } from '@/lib/workspace-files/application/operations'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const POST = defineV2JsonRoute({
  contract: v2MoveFileItemsContract,
  auth: v2ApiKeyAuth,
  operation: fileOperations.move,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2FileErrorPolicies.default,
  mapInput: ({ body }) => ({
    workspaceId: body.workspaceId,
    fileIds: body.fileIds,
    targetFolderPath: body.targetFolderPath ?? '/',
  }),
  useCase: moveWorkspaceFileItemsOperation,
  present: ({ movedItems }) => ({ data: { movedItems: { files: movedItems.files } } }),
})
