import { renameProjectFileContract } from '@/lib/api/contracts/project-file-lifecycle'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { projectFileOperations, renameProjectFile } from '@/lib/projects/files/application'

export const PATCH = defineInternalJsonRoute({
  contract: renameProjectFileContract,
  auth: internalSessionAuth,
  operation: projectFileOperations.rename,
  rateLimit: internalRateLimits.user({ bucketName: 'project-files.write' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, body }) => ({ projectId: params.id, fileId: params.fileId, ...body }),
  useCase: renameProjectFile,
})
