import { restoreProjectFileContract } from '@/lib/api/contracts/project-file-lifecycle'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { projectFileOperations, restoreProjectFile } from '@/lib/projects/files/application'

export const POST = defineInternalJsonRoute({
  contract: restoreProjectFileContract,
  auth: internalSessionAuth,
  operation: projectFileOperations.restore,
  rateLimit: internalRateLimits.user({ bucketName: 'project-files.write' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => ({ projectId: params.id, fileId: params.fileId }),
  useCase: restoreProjectFile,
})
