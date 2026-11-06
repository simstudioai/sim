import { archiveProjectFileItemsContract } from '@/lib/api/contracts/project-file-lifecycle'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { archiveProjectFileItems, projectFileOperations } from '@/lib/projects/files/application'

export const POST = defineInternalJsonRoute({
  contract: archiveProjectFileItemsContract,
  auth: internalSessionAuth,
  operation: projectFileOperations.archiveItems,
  rateLimit: internalRateLimits.user({ bucketName: 'project-files.write' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, body }) => ({ projectId: params.id, ...body }),
  useCase: archiveProjectFileItems,
})
