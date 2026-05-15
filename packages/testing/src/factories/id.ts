import { generateRandomString } from '@sim/utils/random'

/**
 * Generates a short, URL-safe random ID for test fixtures.
 *
 * Uses the shared app-level random utility for consistency.
 */
export function shortId(size = 8): string {
  return generateRandomString(size)
}
