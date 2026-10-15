import { moveProjectFileItemsContract } from '@/lib/api/contracts/project-file-lifecycle'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { moveProjectFileItems, projectFileOperations } from '@/lib/projects/files/application'

export const POST = defineInternalJsonRoute({
  contract: moveProjectFileItemsContract,
  auth: internalSessionAuth,
  operation: projectFileOperations.moveItems,
  rateLimit: internalRateLimits.user({ bucketName: 'project-files.write' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, body }) => ({ projectId: params.id, ...body }),
  useCase: moveProjectFileItems,
})
