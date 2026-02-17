import { ConfluenceIcon, GithubIcon, LinearIcon, NotionIcon } from '@/components/icons'

interface ConnectorMeta {
  icon: React.ComponentType<{ className?: string }>
  name: string
}

/** Connector type → client-safe metadata (icon + display name) */
export const CONNECTOR_META: Record<string, ConnectorMeta> = {
  confluence: { icon: ConfluenceIcon, name: 'Confluence' },
  github: { icon: GithubIcon, name: 'GitHub' },
  linear: { icon: LinearIcon, name: 'Linear' },
  notion: { icon: NotionIcon, name: 'Notion' },
}

/** Connector type → icon component mapping for client-side use */
export const CONNECTOR_ICONS: Record<
  string,
  React.ComponentType<{ className?: string }>
> = Object.fromEntries(Object.entries(CONNECTOR_META).map(([k, v]) => [k, v.icon]))
