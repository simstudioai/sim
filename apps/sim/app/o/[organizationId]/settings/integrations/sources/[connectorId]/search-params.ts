import { parseAsStringLiteral } from 'nuqs/server'

export const sourceViewParam = {
  key: 'view',
  parser: parseAsStringLiteral(['documents', 'settings', 'history']).withDefault('documents'),
} as const

export const sourceDocumentFilterParam = {
  key: 'document-filter',
  parser: parseAsStringLiteral(['active', 'excluded', 'failed']).withDefault('active'),
} as const

export type SourceView = NonNullable<ReturnType<typeof sourceViewParam.parser.parse>>
