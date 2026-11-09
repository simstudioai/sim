import { parseAsStringLiteral } from 'nuqs'

/** `secret-view` deep-links a secret to its usage view, a destination of its own. */
export const secretDetailViewParam = {
  key: 'secret-view',
  parser: parseAsStringLiteral(['usage'] as const),
} as const

/** Opening the usage view is a destination: push to history; clear on close. */
export const secretDetailViewUrlKeys = {
  history: 'push',
  clearOnDefault: true,
} as const

/** The usage view's tab, so a shared `secret-view=usage` link can land on either reading. */
export const secretUsageTabParam = {
  key: 'usage-tab',
  parser: parseAsStringLiteral(['references', 'logs'] as const).withDefault('logs'),
} as const

/** Tab view-state: clean URLs, no back-stack churn. */
export const secretUsageTabUrlKeys = {
  history: 'replace',
  clearOnDefault: true,
} as const
