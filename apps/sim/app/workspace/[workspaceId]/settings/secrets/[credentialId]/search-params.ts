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

/**
 * Active tab inside the usage view, so a shared `secret-view=usage` link can land on either
 * reading. Defaults to `logs`, which is what the header's "See usage" opened before References
 * existed — the action's name still promises the trail.
 */
export const secretUsageTabParam = {
  key: 'usage-tab',
  parser: parseAsStringLiteral(['references', 'logs'] as const).withDefault('logs'),
} as const

/** Tab view-state: clean URLs, no back-stack churn. */
export const secretUsageTabUrlKeys = {
  history: 'replace',
  clearOnDefault: true,
} as const
