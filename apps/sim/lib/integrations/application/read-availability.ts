import {
  assertOperationPrincipal,
  defineOperation,
  type OperationUseCase,
} from '@/lib/core/application'
import { getAllowedIntegrationsFromEnv } from '@/lib/core/config/env-flags'
import type { IntegrationAvailability } from '@/lib/integrations/availability'
import {
  getIntegrationAvailability,
  getOAuthServiceAvailability,
} from '@/lib/integrations/availability.server'
import { getAllOAuthServices } from '@/lib/oauth/utils'

// permission-group-exempt: deployment capabilities reveal no credentials or workspace resources; each integration operation enforces its own access.
const readAvailabilityOperation = defineOperation({
  id: 'integrations.deployment_availability.read',
  capability: 'none',
  principalKinds: ['session'],
})

interface ReadIntegrationAvailabilityResult {
  allowedIntegrations: string[] | null
  integrationAvailability: Pick<IntegrationAvailability, 'type' | 'state' | 'oauthAvailable'>[]
  oauthServiceAvailability: { providerId: string; available: boolean }[]
}

/** Provides the deployment capability catalog shared by API reads and server hydration. */
export const readIntegrationAvailability: OperationUseCase<
  typeof readAvailabilityOperation,
  undefined,
  ReadIntegrationAvailabilityResult
> = {
  operation: readAvailabilityOperation,
  async execute({ principal }) {
    assertOperationPrincipal(principal, readAvailabilityOperation)
    return {
      allowedIntegrations: getAllowedIntegrationsFromEnv(),
      integrationAvailability: getIntegrationAvailability().map(
        ({ type, state, oauthAvailable }) => ({ type, state, oauthAvailable })
      ),
      oauthServiceAvailability: getOAuthServiceAvailability(getAllOAuthServices()),
    }
  },
}
