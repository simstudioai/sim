import { createSearchParamsCache, parseAsStringLiteral } from 'nuqs/server'

const CLI_AUTH_DONE_STATUSES = ['approved', 'cancelled'] as const

export type CliAuthDoneStatus = (typeof CLI_AUTH_DONE_STATUSES)[number]

/** Informational only; an omitted status preserves existing pairing callbacks. */
export const cliAuthDoneSearchParamsCache = createSearchParamsCache({
  status: parseAsStringLiteral(CLI_AUTH_DONE_STATUSES).withDefault('approved'),
})
