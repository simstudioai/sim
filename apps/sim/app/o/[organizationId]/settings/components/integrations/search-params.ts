import { parseAsStringLiteral } from 'nuqs/server'

export const organizationIntegrationsTabParam = {
  key: 'tab',
  parser: parseAsStringLiteral(['providers', 'people']).withDefault('providers'),
} as const

export const connectedAccountsParam = {
  key: 'connectedAccounts',
  parser: parseAsStringLiteral(['slack']),
} as const
