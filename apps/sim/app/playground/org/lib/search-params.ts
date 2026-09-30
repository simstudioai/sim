import { parseAsString, parseAsStringLiteral } from 'nuqs/server'

export const protoParsers = {
  /** `kind:workspaceId:id` of a resource a new chat starts with open; empty for none. */
  open: parseAsString.withDefault(''),
  dashboard: parseAsStringLiteral([
    'support-operations',
    'infra-analyzer',
    'growth-funnel',
  ] as const),
}
