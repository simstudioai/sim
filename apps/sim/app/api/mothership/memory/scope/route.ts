import { readMemoryScopeContract } from '@/lib/api/contracts/mothership-memory'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
} from '@/lib/api/server/routes'
import { internalCopilotAuth } from '@/lib/mothership/auth/internal'
import {
  MEMORY_SCOPE_AUDIENCE,
  readMemoryScope,
  readMemoryScopeOperation,
} from '@/lib/mothership/memory/application/read-scope'

export const POST = defineInternalJsonRoute({
  contract: readMemoryScopeContract,
  auth: internalCopilotAuth(MEMORY_SCOPE_AUDIENCE, { organization: true }),
  operation: readMemoryScopeOperation,
  rateLimit: internalRateLimits.none({
    reason: 'Authenticated worker resolves its current private chat memory scope.',
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ body }) => body,
  useCase: readMemoryScope,
})
