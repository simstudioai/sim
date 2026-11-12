import type { OAuthService } from '@/lib/oauth/types'
import type { ConnectorAuthConfig, ConnectorConfigField } from '@/connectors/types'

/** The same selected-source requirements drive credential filtering, validation, and token minting. */
export function getConnectorRequiredScopes(
  auth: ConnectorAuthConfig,
  sourceConfig: Record<string, unknown>
): string[] {
  return auth.mode === 'oauth'
    ? (auth.requiredScopesForConfig?.(sourceConfig) ?? auth.requiredScopes ?? [])
    : []
}

/** Whether a credential can authenticate the selected connection method. */
export function isConnectorCredentialTypeAllowed(
  auth: ConnectorAuthConfig,
  accessMode: string,
  credentialType: 'oauth' | 'service_account' | 'managed_oauth' | undefined
): boolean {
  if (credentialType === 'managed_oauth') return false
  return (
    auth.mode !== 'oauth' ||
    accessMode !== 'admin' ||
    !auth.adminCredentialType ||
    credentialType === auth.adminCredentialType
  )
}

/** The service whose saved credentials can authenticate this connector, if any. */
export function getConnectorCredentialService(auth: ConnectorAuthConfig): OAuthService | undefined {
  return auth.mode === 'oauth' ? auth.provider : auth.savedCredential?.provider
}

/**
 * Whether a connector row authenticates with its saved credential rather than a stored key.
 *
 * An OAuth connector uses its credential unless it also takes a token and the row stores
 * only that. A key connector uses a credential only when it declares a `savedCredential`
 * alternative and the row names one; creation and access updates never bind a credential to
 * a row that stores a key, so such a row keeps using its key.
 */
export function connectorUsesCredential(
  auth: ConnectorAuthConfig,
  connector: { credentialId: string | null; encryptedApiKey: string | null }
): boolean {
  if (auth.mode === 'apiKey') return Boolean(auth.savedCredential && connector.credentialId)
  return !(auth.apiKey && !connector.credentialId && connector.encryptedApiKey)
}

/** How a connector row authenticates, as recorded in audit metadata. */
export function connectorAuthModeLabel(
  authMode: ConnectorAuthConfig['mode'],
  usesCredential: boolean
): 'apiKey' | 'oauth' | 'savedCredential' {
  if (!usesCredential) return 'apiKey'
  return authMode === 'apiKey' ? 'savedCredential' : 'oauth'
}

/**
 * Whether a workspace-mode connector row still carries something to authenticate with. A
 * connector whose credential was removed keeps its documents but has no token source, so a
 * sync cannot run until it is reconnected.
 */
export function connectorHasAuthSource(
  auth: ConnectorAuthConfig,
  connector: { credentialId: string | null; encryptedApiKey: string | null }
): boolean {
  if (connectorUsesCredential(auth, connector)) return Boolean(connector.credentialId)
  return Boolean(connector.encryptedApiKey) || getConnectorApiKeyConfig(auth)?.optional === true
}

/** Whether a config field applies to how the connector authenticates: key-only fields drop out with a saved credential. */
export function isConnectorFieldForAuth(
  field: Pick<ConnectorConfigField, 'apiKeyOnly'>,
  authenticatesWithKey: boolean
): boolean {
  return authenticatesWithKey || !field.apiKeyOnly
}

/** Workspace token input supported by a connector, independent of its member OAuth method. */
export function getConnectorApiKeyConfig(
  auth: ConnectorAuthConfig
):
  | Pick<Extract<ConnectorAuthConfig, { mode: 'apiKey' }>, 'label' | 'placeholder' | 'optional'>
  | undefined {
  return auth.mode === 'apiKey' ? auth : auth.apiKey
}
