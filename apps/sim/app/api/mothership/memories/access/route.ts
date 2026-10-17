import { resolveMemoryNotesAccessContract } from '@/lib/api/contracts/mothership-memories'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
} from '@/lib/api/server/routes'
import { internalCopilotAuth } from '@/lib/mothership/auth/internal'
import {
  MEMORY_NOTES_ACCESS_AUDIENCE,
  resolveMemoryNotesAccess,
  resolveMemoryNotesAccessOperation,
} from '@/lib/mothership/memories/application/resolve-access'

export const POST = defineInternalJsonRoute({
  contract: resolveMemoryNotesAccessContract,
  auth: internalCopilotAuth(MEMORY_NOTES_ACCESS_AUDIENCE, { organization: true }),
  operation: resolveMemoryNotesAccessOperation,
  rateLimit: internalRateLimits.none({
    reason:
      'Private worker preflight rechecks live memory authority without reading or writing note content.',
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ body }) => body,
  useCase: resolveMemoryNotesAccess,
})
