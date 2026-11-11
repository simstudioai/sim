import type { IntegrationPerson } from '@/platform/lib/integrations/center-model'
import type { ToolPolicy } from '@/platform/shared/integrations'

/** An account's Assistant tool policies: a default per kind and each tool's override. */
export interface CredentialToolPermissions {
  read: ToolPolicy
  write: ToolPolicy
  canAutoApprove: boolean
  tools: {
    id: string
    label: string
    description?: string
    kind: 'read' | 'write'
    override: ToolPolicy | null
  }[]
}

export interface CredentialMember extends IntegrationPerson {
  userId: string
  email?: string
  role: 'admin' | 'member'
  roleSource: 'explicit' | 'workspace-admin' | 'organization-admin'
  explicitAdmin: boolean
  status: 'active' | 'pending' | 'revoked'
}

/** UI metadata only: provider secrets and tokens never enter the product session. */
export interface IntegrationCredential {
  id: string
  appId: string
  providerId: string
  type: 'oauth' | 'service_account' | 'personal_token' | 'mcp' | 'slack' | 'secret'
  displayName: string
  description: string
  accountLabel?: string
  instanceUrl?: string
  /** What the connection calls `instanceUrl`, such as GitLab host or Environment URL. */
  instanceLabel?: string
  role: 'admin' | 'member'
  status: 'active' | 'needs_reauth'
  canReconnect: boolean
  scope:
    | { kind: 'workspace'; id: string; name: string }
    | { kind: 'organization'; id: string; name: string }
    | { kind: 'personal'; ownerId: string }
    | { kind: 'organization-managed'; id: string; name: string }
  members: readonly CredentialMember[]
  permissions?: CredentialToolPermissions
}

export interface CredentialField {
  id: string
  label: string
  placeholder?: string
  secret?: boolean
  multiline?: boolean
  optional?: boolean
  defaultValue?: string
  options?: readonly { value: string; label: string }[]
  visibleWhen?: { field: string; values: readonly string[] }
}

/** Public enrollment requirements projected from the existing connection definitions. */
export interface CredentialConnection {
  id: string
  kind: Exclude<IntegrationCredential['type'], 'secret'>
  label: string
  providerId: string
  setup: 'oauth' | 'mcp-oauth' | 'fields' | 'google-json' | 'slack-bot' | 'oracle-database'
  requiredScopes?: readonly { id: string; label: string }[]
  fields: readonly CredentialField[]
  personalOnly?: boolean
  /** The OAuth service a service account connects for, which decides keyless Google setup. */
  oauthServiceId?: string
}
