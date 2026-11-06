import { updateProjectFileFolderContract } from '@/lib/api/contracts/project-file-folders'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { projectFileOperations, updateProjectFileFolder } from '@/lib/projects/files/application'

export const PATCH = defineInternalJsonRoute({
  contract: updateProjectFileFolderContract,
  auth: internalSessionAuth,
  operation: projectFileOperations.updateFolder,
  rateLimit: internalRateLimits.user({ bucketName: 'project-file-folders.write' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, body }) => ({ projectId: params.id, folderId: params.folderId, ...body }),
  useCase: updateProjectFileFolder,
  present: (result) => result,
})
