export type SearchMode = 'member' | 'service_account'
export type AccountMethod = 'oauth' | 'mcp' | 'slack' | 'databricks'
export type ToolPolicy = 'allow' | 'ask' | 'block'

export const ACCOUNT_METHOD_LABELS: Record<AccountMethod, string> = {
  oauth: 'OAuth',
  mcp: 'Managed MCP',
  slack: 'Slack app',
  databricks: 'Databricks MCP',
}

export interface IntegrationProvider {
  id: string
  name: string
  description: string
  searchModes: readonly SearchMode[]
  accountMethods: readonly AccountMethod[]
}

/** Member Search provisions a provider sign-in method independently of workflow accounts. */
export function memberSearchMethod(provider: IntegrationProvider) {
  if (!provider.searchModes.includes('member')) return undefined
  return provider.accountMethods.find((method) => method === 'mcp') ?? provider.accountMethods[0]
}

export interface IntegrationDraft {
  providerId: string
  searchMode: SearchMode | null
  accountMethod: AccountMethod | null
  label: string
  required: boolean
  endpoint?: string
  clientId?: string
}

export interface IntegrationAccount {
  id: string
  label: string
  method: AccountMethod
  status: 'active' | 'needs_reauth'
  permissions?: {
    read: ToolPolicy
    write: ToolPolicy
    canAutoApprove: boolean
    tools: { id: string; label: string; kind: 'read' | 'write'; override: ToolPolicy | null }[]
  }
}

export interface IntegrationPerson {
  id: string
  email: string
  status:
    | 'draft'
    | 'invited'
    | 'delivery_failed'
    | 'in_progress'
    | 'completed'
    | 'revoked'
    | 'expired'
}

export interface IntegrationSource {
  id: string
  label: string
  mode: SearchMode
  available: boolean
  enabled: boolean
  draft?: boolean
  scope?: { label: string; values: string[] }[]
  gitlabPermissions?:
    | { mode: 'administrator' }
    | { mode: 'csv'; userMapping: string; projectPermissions: string }
}

export interface OrganizationIntegration {
  providerId: string
  label: string
  required: boolean
  accountMethods: AccountMethod[]
  accounts: IntegrationAccount[]
  people: IntegrationPerson[]
  searchApproved: boolean
  searchMode: SearchMode | null
  sourceId: string | null
  sources: IntegrationSource[]
  slackStatus?: 'not_configured' | 'ready' | 'needs_update'
  slackTeam?: string
  endpoint?: string
  clientId?: string
}

export type WorkspaceAccess = { mode: 'all' } | { mode: 'selected'; credentialTypes: string[] }

export interface IntegrationsData {
  canManage: boolean
  providers: IntegrationProvider[]
  integrations: OrganizationIntegration[]
  workspaces: { id: string; name: string }[]
  credentialTypes: { id: string; label: string }[]
  workspaceGrants: Record<string, WorkspaceAccess>
}
