import { restoreProjectFileFolderContract } from '@/lib/api/contracts/project-file-lifecycle'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { projectFileOperations, restoreProjectFileFolder } from '@/lib/projects/files/application'

export const POST = defineInternalJsonRoute({
  contract: restoreProjectFileFolderContract,
  auth: internalSessionAuth,
  operation: projectFileOperations.restoreFolder,
  rateLimit: internalRateLimits.user({ bucketName: 'project-files.write' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => ({ projectId: params.id, folderId: params.folderId }),
  useCase: restoreProjectFileFolder,
})
