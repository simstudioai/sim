export interface CredentialProvider {
  key: string
  provider: string
  name: string
  method: 'oauth' | 'mcp'
}

export interface WorkspaceGrant {
  workspaceId: string
  types: 'all' | string[]
}

export interface DatabricksConfiguration {
  name: string
  url: string
  clientId: string
  hasSecret: boolean
}

export interface CredentialGroupsData {
  slackTeams?: readonly string[]
  databricks?: DatabricksConfiguration
  setup: boolean
  canManage: boolean
  catalog: CredentialProvider[]
  configured: string[]
  people: { email: string; revoked: boolean; accounts: string[] }[]
  nextCursor?: string | null
  workspaces: { id: string; name: string }[]
  grants: WorkspaceGrant[]
  credentialTypes: { value: string; label: string }[]
}
