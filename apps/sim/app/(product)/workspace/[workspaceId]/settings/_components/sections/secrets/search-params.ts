import { parseAsStringLiteral } from 'nuqs'

/** `secret` opens one secret's detail over the list. */
export const SECRET_ID_PARAM = 'secret'

/** `secret-view=usage` opens a secret's usage view, a sub-view of its detail. */
export const SECRET_VIEW_PARAM = 'secret-view'

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
