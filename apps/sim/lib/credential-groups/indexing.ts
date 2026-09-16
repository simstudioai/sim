import {
  type CredentialGroupProvider,
  findCredentialGroupProviderFromProviderId,
} from '@/lib/credential-groups/providers'
import { SEARCH_CONNECTORS } from '@/lib/sim-search/connectors'

/** Only connectors with permission-scoped OAuth ingestion can index connected accounts. */
export function getCredentialGroupIndexingConnector(provider: CredentialGroupProvider) {
  return SEARCH_CONNECTORS.find(
    (connector) => findCredentialGroupProviderFromProviderId(connector.providerId) === provider
  )
}
