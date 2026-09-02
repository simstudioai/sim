import type { ComponentType, CSSProperties } from 'react'

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
 * on click; `connector` rows — the Search-mode "Connect X" rows — carry their
 * connect target directly. Both connecting kinds open the OAuth connect modal.
 */
export type Action =
  | { kind: 'prompt'; id: string; label: string; icon: ActionIcon; prompt: string }
  | { kind: 'integration'; id: string; label: string; icon: ActionIcon; slug: string }
  | { kind: 'connector'; id: string; label: string; icon: ActionIcon; target: OAuthConnectTarget }
