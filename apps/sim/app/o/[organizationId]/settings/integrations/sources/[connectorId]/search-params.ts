import { parseAsStringLiteral } from 'nuqs/server'
import { connectorDocumentFilterSchema } from '@/lib/api/contracts/knowledge/connectors'

export const sourceViewParam = {
  key: 'view',
  parser: parseAsStringLiteral(['documents', 'settings', 'history']).withDefault('documents'),
} as const

export const sourceDocumentFilterParam = {
  key: 'document-filter',
  parser: parseAsStringLiteral(connectorDocumentFilterSchema.options).withDefault('active'),
} as const

export type SourceView = NonNullable<ReturnType<typeof sourceViewParam.parser.parse>>
