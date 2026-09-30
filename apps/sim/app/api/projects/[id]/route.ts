import { renameProjectContract } from '@/lib/api/contracts/projects'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { projectOperations, renameProject } from '@/lib/projects/application/projects'

export const PATCH = defineInternalJsonRoute({
  contract: renameProjectContract,
  auth: internalSessionAuth,
  operation: projectOperations.rename,
  rateLimit: internalRateLimits.none({ reason: 'Admin renaming a project they administer' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, body }) => ({ projectId: params.id, name: body.name }),
  useCase: renameProject,
})
