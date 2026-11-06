import { createLoader, createSerializer, parseAsString } from 'nuqs/server'

/** The list's search text, written raw and debounced on the way to the URL. */
export const integrationSearchParsers = {
  q: parseAsString.withDefault(''),
} as const

export const integrationSearchUrlKeys = {
  history: 'replace',
  clearOnDefault: true,
} as const

export const integrationViewParsers = {
  integration: parseAsString,
  account: parseAsString,
  tools: parseAsString.withDefault(''),
} as const

export const serializeIntegrationView = createSerializer({
  ...integrationSearchParsers,
  ...integrationViewParsers,
})

/** Reads a link from before providers had their own route, so it can be sent there. */
export const loadIntegrationView = createLoader({
  ...integrationSearchParsers,
  ...integrationViewParsers,
})

export const integrationConnectionParams = {
  connectorType: parseAsString.withDefault(''),
  connectionMode: parseAsString.withDefault(''),
  optionId: parseAsString.withDefault(''),
  savedProviderId: parseAsString.withDefault(''),
  provider: parseAsString.withDefault(''),
  connectorId: parseAsString.withDefault(''),
  credentialId: parseAsString.withDefault(''),
}

export const loadIntegrationConnectionParams = createLoader(integrationConnectionParams)
