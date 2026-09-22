import type { ConnectorAuthConfig } from '@/connectors/types'

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

/**
 * Whether a workspace-mode connector row still carries something to authenticate with. A
 * connector whose credential was removed keeps its documents but has no token source, so a
 * sync cannot run until it is reconnected.
 */
export function connectorHasAuthSource(
  auth: ConnectorAuthConfig,
  connector: { credentialId: string | null; encryptedApiKey: string | null }
): boolean {
  if (auth.mode === 'apiKey') return true
  if (connector.credentialId) return true
  return Boolean(getConnectorApiKeyConfig(auth) && connector.encryptedApiKey)
}

/** Workspace token input supported by a connector, independent of its member OAuth method. */
export function getConnectorApiKeyConfig(
  auth: ConnectorAuthConfig
):
  | Pick<Extract<ConnectorAuthConfig, { mode: 'apiKey' }>, 'label' | 'placeholder' | 'optional'>
  | undefined {
  return auth.mode === 'apiKey' ? auth : auth.apiKey
}
