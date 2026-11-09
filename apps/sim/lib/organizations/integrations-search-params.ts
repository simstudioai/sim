import { createSerializer, parseAsString } from 'nuqs/server'

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
