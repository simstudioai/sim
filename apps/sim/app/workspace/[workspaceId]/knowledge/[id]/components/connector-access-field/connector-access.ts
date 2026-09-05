import type { ConnectorAccessMode } from '@/lib/api/contracts/knowledge/connectors'
import {
  type CredentialGroupProvider,
  findCredentialGroupProviderFromProviderId,
} from '@/lib/credential-groups/providers'
import { aclIsDerived } from '@/lib/knowledge/connectors/access-modes'
import type { ConnectorMeta } from '@/connectors/types'

/** The credential-group provider that collects accounts for this connector, if any. */
export function connectorMemberProvider(
  connectorConfig: ConnectorMeta
): CredentialGroupProvider | null {
  if (connectorConfig.auth.mode !== 'oauth' || !connectorConfig.permissionScopedListing) return null
  return findCredentialGroupProviderFromProviderId(connectorConfig.auth.provider)
}

/** The config fields a per-member connector hides: its listing caps, which the server clears. */
export function derivedAclCapFieldIds(
  connectorConfig: ConnectorMeta | null,
  accessMode: ConnectorAccessMode
): ReadonlySet<string> {
  return new Set(
    aclIsDerived(accessMode) ? (connectorConfig?.permissionScopedListing?.capFieldIds ?? []) : []
  )
}
