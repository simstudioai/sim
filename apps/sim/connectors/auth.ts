import type { ConnectorAuthConfig } from '@/connectors/types'

/** Whether a credential can authenticate the selected connection method. */
export function isConnectorCredentialTypeAllowed(
  auth: ConnectorAuthConfig,
  accessMode: string,
  credentialType: 'oauth' | 'service_account' | undefined
): boolean {
  return (
    auth.mode !== 'oauth' ||
    accessMode !== 'admin' ||
    !auth.adminCredentialType ||
    credentialType === auth.adminCredentialType
  )
}

/** Workspace token input supported by a connector, independent of its member OAuth method. */
export function getConnectorApiKeyConfig(
  auth: ConnectorAuthConfig
):
  | Pick<Extract<ConnectorAuthConfig, { mode: 'apiKey' }>, 'label' | 'placeholder' | 'optional'>
  | undefined {
  return auth.mode === 'apiKey' ? auth : auth.apiKey
}
