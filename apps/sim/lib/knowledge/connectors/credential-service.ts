import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  getServiceConfigByProviderId,
  getServiceConfigByServiceId,
  type ServiceProviderIdentity,
} from '@/lib/oauth'
import { getConnectorCredentialService } from '@/connectors/auth'
import type { ConnectorMeta } from '@/connectors/types'

/**
 * The OAuth service a connector's credential must belong to. Setting up a key
 * connector on its saved credential and every access update resolve it here, so
 * a connector whose declared service has no config is refused instead of
 * skipping the provider check. Callers reach it only for a connector that takes
 * a credential, so a missing service is a connector-definition fault, not one
 * the caller can fix.
 */
export function requireConnectorCredentialService(
  connectorMeta: Pick<ConnectorMeta, 'name' | 'auth'>
): ServiceProviderIdentity {
  const credentialService = getConnectorCredentialService(connectorMeta.auth)
  const service = credentialService
    ? (getServiceConfigByServiceId(credentialService) ??
      getServiceConfigByProviderId(credentialService))
    : null
  if (!service) {
    throw new OrchestrationError(
      'internal',
      `${connectorMeta.name} has no OAuth service to validate the credential against`
    )
  }
  return service
}
