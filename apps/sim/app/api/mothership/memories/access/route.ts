import { resolveMemoryAccessContract } from '@/lib/api/contracts/mothership-memories'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
} from '@/lib/api/server/routes'
import { internalCopilotAuth } from '@/lib/mothership/auth/internal'
import {
  MEMORY_ACCESS_AUDIENCE,
  resolveMemoryAccess,
  resolveMemoryAccessOperation,
} from '@/lib/mothership/memories/application/resolve-access'

export const POST = defineInternalJsonRoute({
  contract: resolveMemoryAccessContract,
  auth: internalCopilotAuth(MEMORY_ACCESS_AUDIENCE, { organization: true }),
  operation: resolveMemoryAccessOperation,
  rateLimit: internalRateLimits.none({
    reason:
      'Private worker preflight rechecks live memory authority without reading or writing note content.',
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ body }) => body,
  useCase: resolveMemoryAccess,
})
