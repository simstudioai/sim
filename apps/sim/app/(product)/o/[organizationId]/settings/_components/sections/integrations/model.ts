interface SourceField {
  id: string
  label: string
  required: boolean
  options?: readonly { value: string; label: string }[]
  placeholder?: string
  optional: boolean
  mode?: 'basic' | 'advanced'
}

export interface SearchSource {
  id: string
  name: string
  supportedModes: readonly ('member' | 'service_account')[]
  fields: readonly SourceField[]
  connectionLabels: { add: string; title: string; empty: string; searchPlaceholder: string }
  docs?: string
  approved: boolean
  mode: 'member' | 'service_account'
  connectionId?: string
  setupRequired?: boolean
}

export interface SourceConnection {
  id: string
  provider: string
  name: string
  paused: boolean
  fields: Record<string, string>
}

export interface SourceSettingsData {
  assistantApps: { id: string; name: string; account: string | null; approved: boolean }[]
  sources: SearchSource[]
  connections: SourceConnection[]
  secretMode: 'organization' | 'member' | null
  secrets: string[]
  slackApp: string | null
}

/** What a source type's rows and pages call its parts, so no view branches on a provider id. */
export interface SourceTypeMeta {
  /** The admin-managed records behind a service-account source: Connections, Repositories. */
  connections: string
  /** A service-account source's reach, as its row describes it. */
  serviceScope: string
  /** Its service account is an app installation rather than a stored credential. */
  appInstallation: boolean
  /** Always read through admin-managed access, never members' own accounts. */
  serviceAccountOnly: boolean
  /** Answers in Slack through the organization's Slack app. */
  slackApp: boolean
  /** The admin's add action on its connections page; null takes the connector's own label. */
  addConnection: string | null
}

const DEFAULT_SOURCE_TYPE: SourceTypeMeta = {
  connections: 'Connections',
  serviceScope: 'Service account',
  appInstallation: false,
  serviceAccountOnly: false,
  slackApp: false,
  addConnection: 'Add service account',
}

const SOURCE_TYPES: Readonly<Record<string, Partial<SourceTypeMeta>>> = {
  github: {
    connections: 'Repositories',
    serviceScope: 'GitHub App repositories',
    appInstallation: true,
    addConnection: 'Add repository',
  },
  gitlab: {
    connections: 'Projects',
    serviceScope: 'Projects and permissions',
    serviceAccountOnly: true,
    addConnection: null,
  },
  slack: { slackApp: true },
}

export function sourceTypeMeta(type: string): SourceTypeMeta {
  return { ...DEFAULT_SOURCE_TYPE, ...SOURCE_TYPES[type] }
}

/** A source's reach: members' own accounts, or the admin-managed access behind it. */
export function sourceScope(type: string, serviceAccount: boolean, connected: boolean): string {
  const meta = sourceTypeMeta(type)
  if (!serviceAccount && !meta.serviceAccountOnly) return 'Member accounts'
  if (meta.serviceScope !== DEFAULT_SOURCE_TYPE.serviceScope || connected) return meta.serviceScope
  return 'Service account · Add a connection'
}

export function sourceDescription(source: SearchSource) {
  return sourceScope(source.id, source.mode === 'service_account', Boolean(source.connectionId))
}
