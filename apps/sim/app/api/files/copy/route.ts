import { copyFileItemsContract } from '@/lib/api/contracts/file-copy'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { presentCopiedFileItems } from '@/lib/workspace-files/api/copy-presenter'
import { copyFileItems } from '@/lib/workspace-files/application/copy-file-items'
import { fileCopyOperation } from '@/lib/workspace-files/application/copy-operation'

export const POST = defineInternalJsonRoute({
  contract: copyFileItemsContract,
  auth: internalSessionAuth,
  operation: fileCopyOperation,
  rateLimit: internalRateLimits.user({ bucketName: 'files.copy' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ body }) => body,
  useCase: copyFileItems,
  present: presentCopiedFileItems,
})
