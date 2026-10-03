import { createSerializer, parseAsString, parseAsStringLiteral } from 'nuqs/server'

export const organizationIntegrationsTabParam = {
  key: 'tab',
  parser: parseAsStringLiteral(['providers', 'people', 'stats']).withDefault('providers'),
} as const

export const connectedAccountsParam = {
  key: 'connectedAccounts',
  parser: parseAsStringLiteral(['slack']),
} as const

/** An absent integration includes connections from all integrations. */
export const organizationPeopleIntegrationParam = {
  key: 'integration',
  parser: parseAsString,
} as const

export const serializeOrganizationPeople = createSerializer({
  tab: organizationIntegrationsTabParam.parser,
  integration: organizationPeopleIntegrationParam.parser,
  'credential-group-people': parseAsString,
})
