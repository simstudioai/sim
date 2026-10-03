import { readIntegrationCatalogContract } from '@/lib/api/contracts/mothership-integrations'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
} from '@/lib/api/server/routes'
import { internalCopilotAuth } from '@/lib/mothership/auth/internal'
import {
  INTEGRATION_CATALOG_AUDIENCE,
  readIntegrationCatalog,
  readIntegrationCatalogOperation,
} from '@/lib/mothership/integrations/application/catalog'

export const POST = defineInternalJsonRoute({
  contract: readIntegrationCatalogContract,
  auth: internalCopilotAuth(INTEGRATION_CATALOG_AUDIENCE, { organization: true }),
  operation: readIntegrationCatalogOperation,
  rateLimit: internalRateLimits.none({
    reason: 'Private bounded catalog discovery rechecks current authorization on every request.',
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ body }) => body,
  useCase: readIntegrationCatalog,
})
