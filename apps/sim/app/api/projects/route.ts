import { listProjectsContract } from '@/lib/api/contracts/projects'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { listProjects, projectOperations } from '@/lib/projects/application/projects'

export const GET = defineInternalJsonRoute({
  contract: listProjectsContract,
  auth: internalSessionAuth,
  operation: projectOperations.list,
  rateLimit: internalRateLimits.none({ reason: 'Read-only list of the caller’s own projects' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ query }) => query,
  useCase: listProjects,
})
