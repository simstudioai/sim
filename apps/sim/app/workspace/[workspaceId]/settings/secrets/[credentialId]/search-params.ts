import { parseAsStringLiteral } from 'nuqs/server'

/**
 * `secret-view` deep-links a secret to its usage view, opened from the detail header.
 * Mirrors `fork-view` on the Forks tab: usage is its own destination, not a section that
 * expands inside the secret it belongs to.
 */
export const secretDetailViewParam = {
  key: 'secret-view',
  parser: parseAsStringLiteral(['usage'] as const),
} as const

/** Opening the usage view is a destination → push to history; clear on close. */
export const secretDetailViewUrlKeys = {
  history: 'push',
  clearOnDefault: true,
} as const
