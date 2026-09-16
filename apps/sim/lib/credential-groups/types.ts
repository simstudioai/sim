import type { ManagedMcpConnectorId } from '@/lib/credential-groups/managed-mcp-connectors'
import type { CredentialGroupProvider } from '@/lib/credential-groups/providers'

interface CredentialGroupOptionInputBase {
  label: string
  required: boolean
}

export type CredentialGroupOptionInput =
  | (CredentialGroupOptionInputBase & {
      provider: Exclude<CredentialGroupProvider, 'slack'>
    })
  | (CredentialGroupOptionInputBase & {
      provider: 'slack'
      slackBotCredentialId?: string
    })

export type CredentialGroupOptionUpdateInput = CredentialGroupOptionInput & { id?: string }

export interface UpdateCredentialGroupInput {
  options?: CredentialGroupOptionUpdateInput[]
  status?: 'active' | 'disabled'
}

export interface CredentialGroupMcpServer {
  id: string
  name: string
  description: string | null
  authType: string
  enabled: boolean
  managedConnectorId: ManagedMcpConnectorId
}

interface CredentialGroupOptionBase {
  id: string
  label: string
  required: boolean
  status: 'active' | 'disabled'
}

export type CredentialGroupOption =
  | (CredentialGroupOptionBase & {
      provider: Exclude<CredentialGroupProvider, 'slack'>
      configurationStatus: 'ready'
    })
  | (CredentialGroupOptionBase & {
      provider: 'slack'
      slackBotCredentialId?: string
      configurationStatus: 'not_configured' | 'ready' | 'needs_update'
    })

export interface CredentialGroupRecord {
  id: string
  workspaceId: string | null
  organizationId?: string
  name: string
  description: string | null
  options: CredentialGroupOption[]
  mcpServers: CredentialGroupMcpServer[]
  status: 'active' | 'disabled'
  createdAt: string
  updatedAt: string
}

export type CredentialGroupEnrollmentStatus =
  | 'invited'
  | 'delivery_failed'
  | 'in_progress'
  | 'completed'
  | 'revoked'

export interface CredentialGroupEnrollmentRecord {
  id: string
  credentialGroupId: string
  email: string
  status: CredentialGroupEnrollmentStatus
  expiresAt: string
  invitedAt: string
  sentAt: string | null
  completedAt: string | null
  revokedAt: string | null
  expired: boolean
  createdAt: string
  updatedAt: string
}

export interface CredentialGroupEnrollmentConnection {
  provider: CredentialGroupProvider | 'gitlab'
  status: 'active' | 'needs_reauth' | 'revoked'
  count: number
}

export interface CredentialGroupEnrollmentMcpConnection {
  mcpServerId: string
  name: string
  status: 'active' | 'needs_reauth' | 'revoked'
}

export interface CredentialGroupEnrollmentDetail extends CredentialGroupEnrollmentRecord {
  connections: CredentialGroupEnrollmentConnection[]
  mcpConnections: CredentialGroupEnrollmentMcpConnection[]
}

export interface InviteCredentialGroupEnrollmentsInput {
  emails: string[]
}
