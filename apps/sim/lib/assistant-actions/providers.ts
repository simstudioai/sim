import { SEARCH_CONNECTORS } from '@/lib/sim-search/connectors'
import { liveSearchProviderForCredential } from '@/lib/sim-search/live/provider-catalog'

/** Related app credentials inherit the content boundary of their underlying Search source. */
export function assistantSearchSourceForProvider(providerId: string): string | undefined {
  return (
    liveSearchProviderForCredential(providerId) ??
    SEARCH_CONNECTORS.find((entry) => entry.providerIds.includes(providerId))?.type
  )
}
