import { parseAsString } from 'nuqs/server'

/**
 * `data-drain-id` deep-links the Data Drains settings tab to a specific drain's
 * detail sub-view. The "create new" flow stays in local state — only existing
 * entities are deep-linkable.
 */
export const dataDrainIdParam = {
  key: 'data-drain-id',
  parser: parseAsString,
} as const

/** Opening a drain's detail is a destination → push to history; clear on close. */
export const dataDrainIdUrlKeys = {
  history: 'push',
  clearOnDefault: true,
} as const
