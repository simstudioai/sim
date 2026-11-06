import { projectFileListAccessContract } from '@/lib/api/contracts/realtime-file-lists'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
} from '@/lib/api/server/routes'
import { realtimeProjectFileListAuth } from '@/lib/auth/realtime-file-list-delegation'
import { getProjectFileListAccess } from '@/lib/projects/files/application'

export const POST = defineInternalJsonRoute({
  contract: projectFileListAccessContract,
  operation: getProjectFileListAccess.operation,
  auth: realtimeProjectFileListAuth,
  rateLimit: internalRateLimits.none({
    reason:
      'Service-authenticated realtime collection admission and bounded membership revalidation',
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => params,
  useCase: getProjectFileListAccess,
})
