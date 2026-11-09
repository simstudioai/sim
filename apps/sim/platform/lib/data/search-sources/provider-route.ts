import { SEARCH_SOURCE_TYPES } from '@/lib/sim-search/connectors'
import { LIVE_SEARCH_SERVICE_PROVIDERS } from '@/lib/sim-search/live/policy-schema'
import { searchSetupParam } from '@/lib/sim-search/params'

type ProviderRoute =
  | { kind: 'not-found' }
  | { kind: 'sources' }
  | { kind: 'people' }
  | { kind: 'page' }

/**
 * What a provider page's URL resolves to, as the legacy page decided it: an unknown source is not
 * found, a source without service-account connections goes back to Sources, and the old
 * `view=accounts` link (with no setup in progress) opens the people asked to connect accounts.
 */
export function resolveProviderRoute(
  connectorType: string,
  query: Record<string, string | string[] | undefined>
): ProviderRoute {
  if (!SEARCH_SOURCE_TYPES.some(([type]) => type === connectorType)) return { kind: 'not-found' }
  if (!LIVE_SEARCH_SERVICE_PROVIDERS.includes(connectorType)) return { kind: 'sources' }
  const activeSetup =
    typeof query.addConnector === 'string'
      ? searchSetupParam.parser.parse(query.addConnector)
      : null
  if (query.view === 'accounts' && activeSetup === null) return { kind: 'people' }
  return { kind: 'page' }
}
