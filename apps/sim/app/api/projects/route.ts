import { createProjectContract, listProjectsContract } from '@/lib/api/contracts/projects'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { createProject, listProjects, projectOperations } from '@/lib/projects/application'

export const GET = defineInternalJsonRoute({
  contract: listProjectsContract,
  auth: internalSessionAuth,
  operation: projectOperations.list,
  rateLimit: internalRateLimits.user({ bucketName: 'projects.read' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ query }) => query,
  useCase: listProjects,
})

export const POST = defineInternalJsonRoute({
  contract: createProjectContract,
  auth: internalSessionAuth,
  operation: projectOperations.create,
  rateLimit: internalRateLimits.user({ bucketName: 'projects.write' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ body }) => body,
  useCase: createProject,
})
