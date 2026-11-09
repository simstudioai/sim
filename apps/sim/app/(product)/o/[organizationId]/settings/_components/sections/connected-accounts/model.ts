import type { WorkspaceGrant } from '@/platform/lib/data/credential-group-actions'

export interface CredentialProvider {
  key: string
  provider: string
  name: string
  method: 'oauth' | 'mcp'
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
  people: { id: string; email: string; revoked: boolean; accounts: string[] }[]
  nextCursor?: string | null
  workspaces: { id: string; name: string }[]
  grants: WorkspaceGrant[]
  credentialTypes: { value: string; label: string }[]
}
