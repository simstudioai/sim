import { parseAsStringLiteral } from 'nuqs'

/**
 * The query the legacy settings links send (`hooks/use-settings-navigation.ts`): the passwords
 * view, its import dialog, and the clear-all confirmation.
 */
export const browserParsers = {
  browserView: parseAsStringLiteral(['passwords'] as const),
  browserImport: parseAsStringLiteral(['1'] as const),
  browserClear: parseAsStringLiteral(['1'] as const),
} as const

export const browserUrlKeys = {
  history: 'replace',
  shallow: true,
  clearOnDefault: true,
} as const
