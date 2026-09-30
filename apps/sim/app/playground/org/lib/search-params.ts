import { parseAsString, parseAsStringLiteral } from 'nuqs/server'

export const protoParsers = {
  /** Chat open in the slide-in panel next to the project; empty when closed. */
  chat: parseAsString.withDefault(''),
  dashboard: parseAsStringLiteral([
    'support-operations',
    'infra-analyzer',
    'growth-funnel',
  ] as const),
}
