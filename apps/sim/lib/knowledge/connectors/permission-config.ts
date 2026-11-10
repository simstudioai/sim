import type { ConnectorPermissionGrants } from '@/lib/api/contracts/knowledge/connector-permissions'
import type { DbTransaction } from '@/lib/db/types'
import type {
  ConnectorPermissionData,
  ConnectorPermissionSnapshot,
} from '@/lib/knowledge/connectors/permission-store'
import type {
  GitLabPermissionInput,
  GitLabPermissionSummary,
} from '@/connectors/gitlab/permission-config/types'

/** Provider-discriminated private input; it is never persisted in sourceConfig. */
export type ConnectorPermissionConfig = { provider: 'gitlab' } & GitLabPermissionInput
export type ConnectorPermissionSummary = { provider: 'gitlab' } & GitLabPermissionSummary

export interface PrepareConnectorPermissionsInput {
  accessMode: string
  sourceConfig: Record<string, unknown>
  permissionConfig?: ConnectorPermissionConfig
  apiKey?: string
  existing?: {
    id: string
    encryptedApiKey: string | null
    sourceConfig: unknown
  }
}

/** Server-created transaction participant; request data can never supply these callbacks. */
export interface PreparedConnectorPermissions {
  requiresAclReset: boolean
  requiresContentSync: boolean
  encryptedApiKey?: string
  populateSyncContext(context: Record<string, unknown>, connectorId: string): void
  write(tx: DbTransaction, connectorId: string): Promise<void>
}

/** Providers own private configuration and grants; orchestration owns the surrounding transaction. */
export interface ConnectorPermissionConfigCapability {
  grantReplacement?: {
    supports(metadata: unknown): boolean
    prepare(
      snapshot: Pick<ConnectorPermissionSnapshot, 'revision' | 'metadata'>,
      expectedRevision: number,
      permissions: ConnectorPermissionGrants
    ): ConnectorPermissionData
  }
  prepare(
    input: PrepareConnectorPermissionsInput
  ): Promise<PreparedConnectorPermissions | undefined>
  readSummaries(connectorIds: readonly string[]): Promise<Map<string, ConnectorPermissionSummary>>
  populateSyncContext(connectorId: string, context: Record<string, unknown>): Promise<void>
}
