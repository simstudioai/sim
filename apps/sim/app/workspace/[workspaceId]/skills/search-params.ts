import { parseAsString } from 'nuqs/server'

/**
 * Co-located, typed URL query-param definition for the Skills gallery.
 *
 * `skillId` is a LEGACY deep-link param from when skills edited in a modal on
 * this page. Skills now open at `/workspace/[workspaceId]/skills/[skillId]`;
 * the gallery reads this param once and redirects there (read-then-strip).
 */
export const skillIdParam = {
  key: 'skillId',
  parser: parseAsString,
} as const

/** Read-once redirect signal — replace history, never linger. */
export const skillIdUrlKeys = {
  history: 'replace',
  clearOnDefault: true,
} as const

/**
 * `search` filters the skills list by name/description. The input is controlled
 * directly by the instant nuqs value; only its URL write is debounced via
 * `limitUrlUpdates` (`debounce`) on the setter — never written on every
 * keystroke.
 */
export const skillSearchParam = {
  key: 'search',
  parser: parseAsString.withDefault(''),
} as const

/** Search is filter view-state: clean URLs, no back-stack churn. */
export const skillSearchUrlKeys = {
  history: 'replace',
  shallow: true,
  clearOnDefault: true,
} as const
