import type { ConnectorAccessMode } from '@/lib/api/contracts/knowledge/connectors'
import {
  type CredentialGroupProvider,
  findCredentialGroupProviderFromProviderId,
} from '@/lib/credential-groups/providers'
import { aclIsDerived } from '@/lib/knowledge/connectors/access-modes'
import type { ConnectorConfigField, ConnectorMeta } from '@/connectors/types'

/** Administrator crawls require the same impersonation subject enforced by the server. */
export function isConnectorFieldRequired(
  field: ConnectorConfigField,
  connectorConfig: ConnectorMeta,
  accessMode: ConnectorAccessMode
): boolean {
  return Boolean(
    field.required ||
      (accessMode === 'admin' &&
        connectorConfig.auth.mode === 'oauth' &&
        connectorConfig.auth.serviceAccountSubjectFieldId === field.id)
  )
}

/** The credential-group provider that collects accounts for this connector, if any. */
export function connectorMemberProvider(
  connectorConfig: ConnectorMeta
): CredentialGroupProvider | null {
  if (connectorConfig.auth.mode !== 'oauth' || !connectorConfig.permissionScopedListing) return null
  return findCredentialGroupProviderFromProviderId(connectorConfig.auth.provider)
}

/** Derived ACL modes hide listing caps, which the server clears. */
export function derivedAclCapFieldIds(
  connectorConfig: ConnectorMeta | null,
  accessMode: ConnectorAccessMode
): ReadonlySet<string> {
  return new Set(
    aclIsDerived(accessMode) ? (connectorConfig?.permissionScopedListing?.capFieldIds ?? []) : []
  )
}
