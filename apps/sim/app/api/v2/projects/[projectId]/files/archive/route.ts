import { v2ArchiveProjectFileItemsContract } from '@/lib/api/contracts/v2/project-file-lifecycle'
import {
  defineV2JsonRoute,
  v2ApiKeyAuth,
  v2OrchestrationErrorPolicy,
  v2RateLimits,
} from '@/lib/api/server/routes'
import { archiveProjectFileItems } from '@/lib/projects/files/application'
import { projectFileOperations } from '@/lib/projects/files/application/operations'

export const POST = defineV2JsonRoute({
  contract: v2ArchiveProjectFileItemsContract,
  auth: v2ApiKeyAuth,
  operation: projectFileOperations.archiveItems,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrchestrationErrorPolicy,
  mapInput: ({ params, body }) => ({ ...params, ...body }),
  useCase: archiveProjectFileItems,
  present: (result) => ({ data: result }),
})
