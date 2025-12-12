/**
 * Database-only constants used in schema definitions and migrations.
 * These constants are independent of application logic to keep migrations container lightweight.
 */

/**
 * Default free credits (in dollars) for new users
 */
export const DEFAULT_FREE_CREDITS = 10

/**
 * Storage limit constants (in GB)
 * Can be overridden via environment variables
 */
export const DEFAULT_FREE_STORAGE_LIMIT_GB = 5
export const DEFAULT_PRO_STORAGE_LIMIT_GB = 50
export const DEFAULT_TEAM_STORAGE_LIMIT_GB = 500
export const DEFAULT_ENTERPRISE_STORAGE_LIMIT_GB = 500

/**
 * Tag slots available for knowledge base documents and embeddings
 */
export const TAG_SLOTS = ['tag1', 'tag2', 'tag3', 'tag4', 'tag5', 'tag6', 'tag7'] as const

/**
 * Type for tag slot names
 */
export type TagSlot = (typeof TAG_SLOTS)[number]
