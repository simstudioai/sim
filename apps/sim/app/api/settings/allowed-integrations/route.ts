import { getAllowedIntegrationsContract } from '@/lib/api/contracts/common'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { readIntegrationAvailability } from '@/lib/integrations/application/read-availability'

export const GET = defineInternalJsonRoute({
  contract: getAllowedIntegrationsContract,
  operation: readIntegrationAvailability.operation,
  auth: internalSessionAuth,
  rateLimit: internalRateLimits.none({ reason: 'Deployment capability reads are unmetered.' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: () => undefined,
  useCase: readIntegrationAvailability,
})
