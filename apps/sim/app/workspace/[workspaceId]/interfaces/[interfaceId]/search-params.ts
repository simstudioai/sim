import { parseAsString, parseAsStringLiteral } from 'nuqs/server'

export const INTERFACE_MODES = ['edit', 'preview'] as const

/** Canonical editor mode. Declared here so every interface surface shares one type. */
export type InterfaceMode = (typeof INTERFACE_MODES)[number]

/**
 * Co-located URL query-param definitions for the interface editor.
 *
 * - `mode` toggles the edit grid vs the collapsed preview layout.
 * - `module` is the selected module id. `null` (absent) means nothing is
 *   selected — a real state, so it has no default and clears from the URL.
 */
export const interfaceDetailParsers = {
  mode: parseAsStringLiteral(INTERFACE_MODES).withDefault('edit'),
  module: parseAsString,
} as const

/** View-state: clean URLs, no back-stack churn. */
export const interfaceDetailUrlKeys = {
  history: 'replace',
  shallow: true,
  clearOnDefault: true,
} as const
