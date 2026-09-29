import { parseAsString, parseAsStringLiteral } from 'nuqs/server'

export const protoParsers = {
  /** Chat open in the slide-in panel next to the project; empty when closed. */
  chat: parseAsString.withDefault(''),
  /** Project a new chat starts in; `none` means an org-wide chat. */
  project: parseAsString.withDefault('infra'),
  dashboard: parseAsStringLiteral([
    'support-operations',
    'infra-analyzer',
    'growth-funnel',
  ] as const),
}
