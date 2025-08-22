/**
 * Database-only constants used in schema definitions and migrations.
 * These constants are independent of application logic to keep migrations container lightweight.
 */

/**
 * Default free credits (in dollars) for new users
 */
export const DEFAULT_FREE_CREDITS = 10

/**
 * Tag slots available for knowledge base documents and embeddings
 */
export const TAG_SLOTS = ['tag1', 'tag2', 'tag3', 'tag4', 'tag5', 'tag6', 'tag7'] as const

/**
 * Type for tag slot names
 */
export type TagSlot = (typeof TAG_SLOTS)[number]
