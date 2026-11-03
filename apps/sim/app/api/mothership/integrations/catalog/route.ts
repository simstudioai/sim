import { readIntegrationCatalogContract } from '@/lib/api/contracts/mothership-integrations'
import {
  defineInternalJsonRoute,
  internalErrorResponse,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
} from '@/lib/api/server/routes'
import { categorizeMcpServerError, isMcpServerUnavailableError } from '@/lib/mcp/utils'
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
    /**
     * A targeted MCP server that cannot be reached, or that answers `tools/list` with a
     * protocol or HTTP error, is the server's failure, not Sim's.
     */
    project(error) {
      const mcpFailure = categorizeMcpServerError(error)
      if (mcpFailure) return internalErrorResponse(mcpFailure.status, { error: mcpFailure.message })
      if (isMcpServerUnavailableError(error))
        return internalErrorResponse(502, { error: 'MCP server did not answer usefully' })
      return internalOrchestrationErrorPolicy.project(error)
    },
    unhandled: internalOrchestrationErrorPolicy.unhandled,
  },
  mapInput: ({ body }) => body,
  useCase: readIntegrationCatalog,
})
