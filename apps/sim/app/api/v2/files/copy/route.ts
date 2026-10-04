import { v2CopyFileItemsContract } from '@/lib/api/contracts/v2/file-copy'
import {
  defineV2JsonRoute,
  v2ApiKeyAuth,
  v2OrchestrationErrorPolicy,
  v2RateLimits,
} from '@/lib/api/server/routes'
import { presentCopiedFileItems } from '@/lib/workspace-files/api/copy-presenter'
import { copyFileItems } from '@/lib/workspace-files/application/copy-file-items'
import { fileCopyOperations } from '@/lib/workspace-files/application/operations'

export const POST = defineV2JsonRoute({
  contract: v2CopyFileItemsContract,
  auth: v2ApiKeyAuth,
  operation: fileCopyOperations.copy,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrchestrationErrorPolicy,
  mapInput: ({ body }) => body,
  useCase: copyFileItems,
  present: (result) => ({ data: presentCopiedFileItems(result) }),
})
