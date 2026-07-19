import { parseAsBoolean, parseAsString, parseAsStringLiteral } from 'nuqs/server'
import { INTERFACE_MODES } from '@/lib/interfaces/types'

/**
 * Co-located URL query-param definitions for the interface editor.
 *
 * Only the editor **page** writes these. An interface embedded in a host that
 * owns the URL keeps the same state locally — see `useInterfaceEditorState`.
 *
 * - `mode` toggles the edit grid vs the collapsed preview layout.
 * - `module` is the selected module id. `null` (absent) means nothing is
 *   selected — a real state, so it has no default and clears from the URL.
 * - `share` opens the share dialog. It is a destination worth deep-linking, and
 *   both opening and closing pass an explicit `{ history: 'replace' }` so the
 *   dialog toggle never lands in the back/forward stack.
 */
export const interfaceDetailParsers = {
  mode: parseAsStringLiteral(INTERFACE_MODES).withDefault('edit'),
  module: parseAsString,
  share: parseAsBoolean.withDefault(false),
} as const

/** View-state: clean URLs, no back-stack churn. */
export const interfaceDetailUrlKeys = {
  history: 'replace',
  shallow: true,
  clearOnDefault: true,
} as const
