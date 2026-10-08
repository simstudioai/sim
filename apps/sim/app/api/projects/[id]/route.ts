import {
  archiveProjectContract,
  getProjectContract,
  renameProjectContract,
} from '@/lib/api/contracts/projects'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import {
  archiveProject,
  getProject,
  projectOperations,
  renameProject,
} from '@/lib/projects/application'

export const GET = defineInternalJsonRoute({
  contract: getProjectContract,
  auth: internalSessionAuth,
  operation: projectOperations.get,
  rateLimit: internalRateLimits.user({ bucketName: 'projects.read' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, query }) => ({ projectId: params.id, ...query }),
  useCase: getProject,
})
export const PATCH = defineInternalJsonRoute({
  contract: renameProjectContract,
  auth: internalSessionAuth,
  operation: projectOperations.rename,
  rateLimit: internalRateLimits.user({ bucketName: 'projects.write' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, body }) => ({ projectId: params.id, name: body.name }),
  useCase: renameProject,
})
export const DELETE = defineInternalJsonRoute({
  contract: archiveProjectContract,
  auth: internalSessionAuth,
  operation: projectOperations.archive,
  rateLimit: internalRateLimits.user({ bucketName: 'projects.write' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => ({ projectId: params.id }),
  useCase: archiveProject,
})
