/**
 * Limits and constants for user-defined tables
 */
export const TABLE_LIMITS = {
  MAX_TABLES_PER_WORKSPACE: 100,
  MAX_ROWS_PER_TABLE: 10000,
  MAX_ROW_SIZE_BYTES: 100 * 1024, // 100KB
  MAX_COLUMNS_PER_TABLE: 50,
  MAX_TABLE_NAME_LENGTH: 50,
  MAX_COLUMN_NAME_LENGTH: 50,
  MAX_STRING_VALUE_LENGTH: 10000,
  MAX_DESCRIPTION_LENGTH: 500,
  DEFAULT_QUERY_LIMIT: 100,
  MAX_QUERY_LIMIT: 1000,
} as const

/**
 * Valid column types for table schema
 */
export const COLUMN_TYPES = ['string', 'number', 'boolean', 'date', 'json'] as const

export type ColumnType = (typeof COLUMN_TYPES)[number]

/**
 * Regex pattern for valid table and column names
 * Must start with letter or underscore, followed by alphanumeric or underscore
 */
export const NAME_PATTERN = /^[a-z_][a-z0-9_]*$/i
