import type { ConnectorAuthConfig } from '@/connectors/types'

/** Workspace token input supported by a connector, independent of its member OAuth method. */
export function getConnectorApiKeyConfig(
  auth: ConnectorAuthConfig
):
  | Pick<Extract<ConnectorAuthConfig, { mode: 'apiKey' }>, 'label' | 'placeholder' | 'optional'>
  | undefined {
  return auth.mode === 'apiKey' ? auth : auth.apiKey
}
