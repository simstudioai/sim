import { parseAsString } from 'nuqs/server'

/**
 * Co-located, typed URL query-param definition for the Skills gallery.
 *
 * `skillId` deep-links the skill edit modal to a specific skill. The modal
 * opens when a valid id (one that resolves to a loaded skill) is present;
 * closing it clears the param. Opening a skill is a destination, so it lands in
 * the browser history (`history: 'push'`). The "create new skill" flow has no id
 * and stays in local component state.
 */
export const skillIdParam = {
  key: 'skillId',
  parser: parseAsString,
} as const

/** Opening a skill is a destination → push to history; clear on close. */
export const skillIdUrlKeys = {
  history: 'push',
  clearOnDefault: true,
} as const
