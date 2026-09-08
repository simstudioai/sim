import { parseAsStringLiteral } from 'nuqs/server'

export const connectedAccountsParam = {
  key: 'connectedAccounts',
  parser: parseAsStringLiteral(['slack']),
} as const
