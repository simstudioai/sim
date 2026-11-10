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

export function sourceDescription(source: SearchSource) {
  if (source.id === 'gitlab') return 'Projects and permissions'
  if (source.mode === 'member') return 'Member accounts'
  if (source.id === 'github') return 'GitHub App repositories'
  return source.connectionId ? 'Service account' : 'Service account · Add a connection'
}
