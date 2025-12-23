/**
 * Database-only constants used in schema definitions and migrations.
 * These constants are independent of application logic to keep migrations container lightweight.
 */

/**
 * Default free credits (in dollars) for new users
 */
export const DEFAULT_FREE_CREDITS = 20

/**
 * Storage limit constants (in GB)
 * Can be overridden via environment variables
 */
export const DEFAULT_FREE_STORAGE_LIMIT_GB = 5
export const DEFAULT_PRO_STORAGE_LIMIT_GB = 50
export const DEFAULT_TEAM_STORAGE_LIMIT_GB = 500
export const DEFAULT_ENTERPRISE_STORAGE_LIMIT_GB = 500

/**
 * Text tag slots for knowledge base documents and embeddings
 */
export const TEXT_TAG_SLOTS = ['tag1', 'tag2', 'tag3', 'tag4', 'tag5', 'tag6', 'tag7'] as const

/**
 * Number tag slots for knowledge base documents and embeddings (5 slots)
 */
export const NUMBER_TAG_SLOTS = ['number1', 'number2', 'number3', 'number4', 'number5'] as const

/**
 * Date tag slots for knowledge base documents and embeddings (2 slots)
 */
export const DATE_TAG_SLOTS = ['date1', 'date2'] as const

/**
 * Boolean tag slots for knowledge base documents and embeddings (3 slots)
 */
export const BOOLEAN_TAG_SLOTS = ['boolean1', 'boolean2', 'boolean3'] as const

/**
 * All tag slots combined (for backwards compatibility)
 */
export const TAG_SLOTS = [
  ...TEXT_TAG_SLOTS,
  ...NUMBER_TAG_SLOTS,
  ...DATE_TAG_SLOTS,
  ...BOOLEAN_TAG_SLOTS,
] as const

/**
 * Type for all tag slot names
 */
export type TagSlot = (typeof TAG_SLOTS)[number]

/**
 * Type for text tag slot names
 */
export type TextTagSlot = (typeof TEXT_TAG_SLOTS)[number]

/**
 * Type for number tag slot names
 */
export type NumberTagSlot = (typeof NUMBER_TAG_SLOTS)[number]

/**
 * Type for date tag slot names
 */
export type DateTagSlot = (typeof DATE_TAG_SLOTS)[number]

/**
 * Type for boolean tag slot names
 */
export type BooleanTagSlot = (typeof BOOLEAN_TAG_SLOTS)[number]
