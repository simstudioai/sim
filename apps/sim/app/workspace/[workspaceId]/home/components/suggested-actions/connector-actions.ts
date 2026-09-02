import {
  isSearchConnectorConnected,
  SEARCH_CONNECTORS,
  type SearchConnector,
} from '@/lib/sim-search/connectors'
import type { Action } from '@/app/workspace/[workspaceId]/home/components/suggested-actions/types'
import { weightedSample } from '@/app/workspace/[workspaceId]/home/components/suggested-actions/weighted-sample'

/** Rows shown in Search mode — the same count as the Build-mode set. */
const CONNECTOR_ACTION_COUNT = 4

/**
 * Connectors pinned to the head of the Search-mode list, in this order. Keys
 * are `CONNECTOR_META_REGISTRY` keys, as on every {@link SearchConnector}.
 */
export const PINNED_CONNECTOR_TYPES = ['confluence', 'jira', 'jsm'] as const

const PINNED_TYPES: ReadonlySet<string> = new Set(PINNED_CONNECTOR_TYPES)

/** The pinned connectors, in pinned order. */
const PINNED: readonly SearchConnector[] = PINNED_CONNECTOR_TYPES.flatMap((type) => {
  const connector = SEARCH_CONNECTORS.find((candidate) => candidate.type === type)
  return connector ? [connector] : []
})

/** Every other Sim Search connector — the pool the remaining slots rotate through. */
const ROTATING: readonly SearchConnector[] = SEARCH_CONNECTORS.filter(
  (connector) => !PINNED_TYPES.has(connector.type)
)

function toConnectorAction(connector: SearchConnector): Action {
  return {
    kind: 'connector',
    id: `connect-${connector.type}`,
    label: `Connect ${connector.meta.name}`,
    icon: connector.meta.icon,
    target: connector,
  }
}

/**
 * Builds the Search-mode rows: the pinned connectors first, then a uniform
 * sample of the rest to fill four slots. A connector whose provider the viewer
 * has already connected is dropped from both halves — so Jira and Jira Service
 * Management, which share one provider, leave together — and a pinned slot
 * freed that way is taken by the rotation. Connectors this deployment cannot
 * connect are dropped the same way, so a row never opens a modal that fails.
 */
export function computeConnectorActions(
  connectedProviderIds: ReadonlySet<string>,
  isAvailable: (connector: SearchConnector) => boolean
): Action[] {
  const offered = (connector: SearchConnector) =>
    isAvailable(connector) && !isSearchConnectorConnected(connector, connectedProviderIds)
  const pinned = PINNED.filter(offered)
  const pool = ROTATING.filter(offered)
  const rotating = weightedSample(pool, CONNECTOR_ACTION_COUNT - pinned.length, () => 1)
  return [...pinned, ...rotating].map(toConnectorAction)
}
