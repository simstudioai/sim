import { projectFileDocAccessContract } from '@/lib/api/contracts/project-file-doc'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
} from '@/lib/api/server/routes'
import { realtimeProjectFileAuth } from '@/lib/auth/realtime-file-delegation'
import { getProjectFileDocAccess } from '@/lib/projects/files/application/documents'

export const POST = defineInternalJsonRoute({
  contract: projectFileDocAccessContract,
  operation: getProjectFileDocAccess.operation,
  auth: realtimeProjectFileAuth,
  rateLimit: internalRateLimits.none({
    reason: 'Authenticated realtime relay; socket frame admission bounds collaborative traffic',
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => params,
  useCase: getProjectFileDocAccess,
})
