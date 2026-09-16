import { createLoader, parseAsString } from 'nuqs/server'

export const integrationConnectionParams = {
  connectorType: parseAsString.withDefault(''),
  connectorId: parseAsString.withDefault(''),
  credentialId: parseAsString.withDefault(''),
}

export const loadIntegrationConnectionParams = createLoader(integrationConnectionParams)
