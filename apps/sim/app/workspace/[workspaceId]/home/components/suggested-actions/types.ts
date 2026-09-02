import type { ComponentType, CSSProperties } from 'react'
import type { SearchConnector } from '@/lib/sim-search/connectors'

export type ActionIcon = ComponentType<{ className?: string; style?: CSSProperties }>

/** What the OAuth connect modal needs to start a connection for one service. */
export interface OAuthConnectTarget {
  providerId: string
  requiredScopes: readonly string[]
  serviceName: string
  serviceIcon: ComponentType<{ className?: string }>
}

/**
 * One suggested-action row. `prompt` rows populate the input with a curated
 * prompt; `integration` rows resolve their OAuth service from the catalog slug
 * on click and open the OAuth connect modal; `connector` rows — the Search-mode
 * "Connect X" rows — carry the Sim Search source, which connects through its
 * per-member connector.
 */
export type Action =
  | { kind: 'prompt'; id: string; label: string; icon: ActionIcon; prompt: string }
  | { kind: 'integration'; id: string; label: string; icon: ActionIcon; slug: string }
  | { kind: 'connector'; id: string; label: string; icon: ActionIcon; target: SearchConnector }
