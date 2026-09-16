import { parseAsStringLiteral } from 'nuqs/server'

/**
 * General's sub-view. Unknown values fall back to General rather than rendering
 * an empty detail pane.
 */
export const generalViewParam = {
  key: 'view',
  parser: parseAsStringLiteral(['privacy', 'authorized-apps'] as const),
} as const

/** Opening the sub-view is a destination — Back should return to General. */
export const generalViewUrlKeys = {
  history: 'push',
  clearOnDefault: true,
} as const
