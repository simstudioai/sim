import { createParser, parseAsString } from 'nuqs/server'

/**
 * Parser for the `new` flag. Preserves the prior `?new=1` wire format on
 * serialize while tolerantly accepting the legacy `1`/`true` tokens on parse, so
 * existing shared links keep opening the editor in compose mode.
 */
const parseAsNewFlag = createParser<boolean>({
  parse(value) {
    return value === '1' || value === 'true'
  },
  serialize(value) {
    return value ? '1' : ''
  },
})

/**
 * Co-located, typed URL query-param definitions for the Files feature. The
 * client (`Files`) consumes this typed param definition as the single source of
 * truth.
 *
 * - `folderId` is the currently open folder; it is shareable, bookmarkable, and
 *   navigations between folders belong in the browser history (`history: 'push'`,
 *   the group default).
 * - `new` marks a freshly-created file so the editor opens in compose mode; it is
 *   read once on mount and stripped as the route stabilizes.
 * - `shareFileId` deep-links a file's share dialog open. The modal opens when the
 *   id resolves to a loaded file; closing it clears the param. Opening and
 *   closing the modal use a per-call `{ history: 'replace' }` override so the
 *   dialog toggle does not pollute the back/forward stack (a deep link still
 *   opens it on load).
 */
export const filesParsers = {
  folderId: parseAsString,
  new: parseAsNewFlag.withDefault(false),
  shareFileId: parseAsString,
} as const

/**
 * Shared nuqs options for files query state. Folder navigation is a destination,
 * so the group default lands in the browser history; defaults clear from the URL
 * to keep links clean. Non-navigation writes (the `shareFileId` modal toggle)
 * pass a per-call `{ history: 'replace' }` override so they don't add back-stack
 * entries.
 */
export const filesUrlKeys = {
  history: 'push',
  clearOnDefault: true,
} as const
