/**
 * Knowledge base and document constants
 */

// Maximum number of tag slots allowed per knowledge base
export const MAX_TAG_SLOTS = 7

// Tag slot names (derived from MAX_TAG_SLOTS)
export const TAG_SLOTS = Array.from({ length: MAX_TAG_SLOTS }, (_, i) => `tag${i + 1}`) as [
  string,
  ...string[],
]

// Type for tag slot names
export type TagSlot = (typeof TAG_SLOTS)[number]
