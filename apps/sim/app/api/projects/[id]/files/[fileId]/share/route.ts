import {
  getProjectFileShareContract,
  updateProjectFileShareContract,
} from '@/lib/api/contracts/project-file-shares'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import {
  getProjectFileShare,
  projectFileOperations,
  updateProjectFileShare,
} from '@/lib/projects/files/application'

export const GET = defineInternalJsonRoute({
  contract: getProjectFileShareContract,
  auth: internalSessionAuth,
  operation: projectFileOperations.readShare,
  rateLimit: internalRateLimits.user({ bucketName: 'project-files.read' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => ({ projectId: params.id, fileId: params.fileId }),
  useCase: getProjectFileShare,
})
export const PUT = defineInternalJsonRoute({
  contract: updateProjectFileShareContract,
  auth: internalSessionAuth,
  operation: projectFileOperations.updateShare,
  rateLimit: internalRateLimits.user({ bucketName: 'project-files.write' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, body }) => ({ projectId: params.id, fileId: params.fileId, ...body }),
  useCase: updateProjectFileShare,
})
