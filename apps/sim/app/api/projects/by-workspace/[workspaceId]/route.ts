import { getWorkspaceProjectContract } from '@/lib/api/contracts/projects'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { getWorkspaceProject, projectOperations } from '@/lib/projects/application'

export const GET = defineInternalJsonRoute({
  contract: getWorkspaceProjectContract,
  auth: internalSessionAuth,
  operation: projectOperations.get,
  rateLimit: internalRateLimits.user({ bucketName: 'projects.read' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => params,
  useCase: getWorkspaceProject,
})
