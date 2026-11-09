import { getSuggestedActionCatalogContract } from '@/lib/api/contracts/suggested-actions'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { readSuggestedActionCatalog } from '@/lib/mothership/application/suggested-actions'

export const GET = defineInternalJsonRoute({
  contract: getSuggestedActionCatalogContract,
  operation: readSuggestedActionCatalog.operation,
  auth: internalSessionAuth,
  rateLimit: internalRateLimits.none({ reason: 'The template catalog is static product copy.' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: () => undefined,
  useCase: readSuggestedActionCatalog,
})
