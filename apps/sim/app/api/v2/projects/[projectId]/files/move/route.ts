import { v2MoveProjectFileItemsContract } from '@/lib/api/contracts/v2/project-file-lifecycle'
import {
  defineV2JsonRoute,
  v2ApiKeyAuth,
  v2OrchestrationErrorPolicy,
  v2RateLimits,
} from '@/lib/api/server/routes'
import { moveProjectFileItems } from '@/lib/projects/files/application'
import { projectFileOperations } from '@/lib/projects/files/application/operations'

export const POST = defineV2JsonRoute({
  contract: v2MoveProjectFileItemsContract,
  auth: v2ApiKeyAuth,
  operation: projectFileOperations.moveItems,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrchestrationErrorPolicy,
  mapInput: ({ params, body }) => ({
    ...params,
    ...body,
    targetFolderPath: body.targetFolderPath ?? '/',
  }),
  useCase: moveProjectFileItems,
  present: (result) => ({ data: result }),
})
