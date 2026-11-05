import { createLoader, createSerializer, parseAsString } from 'nuqs/server'
import { organizationPageParsers } from '@/app/o/[organizationId]/components/organization-page/search-params'

export const integrationViewParsers = {
  integration: parseAsString,
  account: parseAsString,
  tools: parseAsString.withDefault(''),
} as const

export const serializeIntegrationView = createSerializer({
  ...organizationPageParsers,
  ...integrationViewParsers,
})

/** Reads a link from before providers had their own route, so it can be sent there. */
export const loadIntegrationView = createLoader({
  ...organizationPageParsers,
  ...integrationViewParsers,
})

export const integrationConnectionParams = {
  connectorType: parseAsString.withDefault(''),
  connectionMode: parseAsString.withDefault(''),
  optionId: parseAsString.withDefault(''),
  provider: parseAsString.withDefault(''),
  connectorId: parseAsString.withDefault(''),
  credentialId: parseAsString.withDefault(''),
}

export const loadIntegrationConnectionParams = createLoader(integrationConnectionParams)
