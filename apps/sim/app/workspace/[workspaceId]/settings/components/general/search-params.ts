import { parseAsStringLiteral } from 'nuqs/server'

/**
 * The sub-view open inside General. Only `privacy` exists today; the literal
 * parser means an unknown value from an old link falls back to General rather
 * than rendering an empty detail pane.
 */
export const generalViewParam = {
  key: 'view',
  parser: parseAsStringLiteral(['privacy'] as const),
} as const

/** Opening the sub-view is a destination — Back should return to General. */
export const generalViewUrlKeys = {
  history: 'push',
  clearOnDefault: true,
} as const
