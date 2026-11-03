import { readIntegrationCatalogContract } from '@/lib/api/contracts/mothership-integrations'
import {
  defineInternalJsonRoute,
  internalErrorResponse,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
} from '@/lib/api/server/routes'
import { categorizeMcpServerError } from '@/lib/mcp/utils'
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
  errorPolicy: {
    /** A targeted MCP server that cannot be reached is the server's failure, not Sim's. */
    project(error) {
      const mcpFailure = categorizeMcpServerError(error)
      if (mcpFailure) return internalErrorResponse(mcpFailure.status, { error: mcpFailure.message })
      return internalOrchestrationErrorPolicy.project(error)
    },
    unhandled: internalOrchestrationErrorPolicy.unhandled,
  },
  mapInput: ({ body }) => body,
  useCase: readIntegrationCatalog,
})
