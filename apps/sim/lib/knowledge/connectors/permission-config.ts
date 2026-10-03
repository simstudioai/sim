import type { DbTransaction } from '@/lib/db/types'
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
  prepare(
    input: PrepareConnectorPermissionsInput
  ): Promise<PreparedConnectorPermissions | undefined>
  readSummaries(connectorIds: readonly string[]): Promise<Map<string, ConnectorPermissionSummary>>
  populateSyncContext(connectorId: string, context: Record<string, unknown>): Promise<void>
}
