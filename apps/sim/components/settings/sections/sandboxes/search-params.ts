import { parseAsString } from 'nuqs/server'

/**
 * The sandbox open in the editor. Only the id lives in the URL; the object is
 * derived from the already-loaded list, so a stale id from an old link simply
 * falls back to the list rather than rendering a broken detail view.
 */
export const sandboxIdParam = {
  key: 'sandboxId',
  parser: parseAsString,
} as const

/** Opening a sandbox is a destination — Back should close it. */
export const sandboxIdUrlKeys = {
  history: 'push',
  clearOnDefault: true,
} as const
