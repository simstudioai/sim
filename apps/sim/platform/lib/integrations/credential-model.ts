import type { IntegrationPerson } from '@/platform/lib/integrations/center-model'
import type { IntegrationAccount } from '@/platform/lib/integrations/fixture-model'

export interface CredentialMember extends IntegrationPerson {
  userId: string
  email?: string
  role: 'admin' | 'member'
  roleSource: 'explicit' | 'workspace-admin'
  explicitAdmin: boolean
  status: 'active' | 'pending' | 'revoked'
}

/** UI metadata only: provider secrets and tokens never enter the product session. */
export interface IntegrationCredential {
  id: string
  appId: string
  providerId: string
  type: 'oauth' | 'service_account' | 'personal_token' | 'mcp' | 'slack'
  displayName: string
  description: string
  accountLabel?: string
  instanceUrl?: string
  role: 'admin' | 'member'
  status: 'active' | 'needs_reauth'
  canReconnect: boolean
  scope:
    | { kind: 'workspace'; id: string; name: string }
    | { kind: 'organization'; id: string; name: string }
    | { kind: 'personal'; ownerId: string }
    | { kind: 'organization-managed'; id: string; name: string }
  members: readonly CredentialMember[]
  permissions?: IntegrationAccount['permissions']
}

export interface CredentialField {
  id: string
  label: string
  placeholder?: string
  hint?: string
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
  kind: IntegrationCredential['type']
  label: string
  providerId: string
  setup: 'oauth' | 'mcp-oauth' | 'fields' | 'google-json' | 'slack-bot' | 'oracle-database'
  requiredScopes?: readonly { id: string; label: string }[]
  fields: readonly CredentialField[]
  personalOnly?: boolean
}
