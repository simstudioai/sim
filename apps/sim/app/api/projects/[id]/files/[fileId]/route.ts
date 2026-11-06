import { renameProjectFileContract } from '@/lib/api/contracts/project-file-lifecycle'
import { getProjectFileContract } from '@/lib/api/contracts/project-files'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import {
  getProjectFileMetadata,
  projectFileOperations,
  renameProjectFile,
} from '@/lib/projects/files/application'

export const GET = defineInternalJsonRoute({
  contract: getProjectFileContract,
  auth: internalSessionAuth,
  operation: projectFileOperations.readMetadata,
  rateLimit: internalRateLimits.user({ bucketName: 'project-files.read' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => ({ projectId: params.id, fileId: params.fileId }),
  useCase: getProjectFileMetadata,
})

export const PATCH = defineInternalJsonRoute({
  contract: renameProjectFileContract,
  auth: internalSessionAuth,
  operation: projectFileOperations.rename,
  rateLimit: internalRateLimits.user({ bucketName: 'project-files.write' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, body }) => ({ projectId: params.id, fileId: params.fileId, ...body }),
  useCase: renameProjectFile,
})
