/**
 * Limits and constants for user-defined tables.
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
  /** Batch size for bulk update operations */
  UPDATE_BATCH_SIZE: 100,
  /** Batch size for bulk delete operations */
  DELETE_BATCH_SIZE: 1000,
  /** Maximum rows per batch insert */
  MAX_BATCH_INSERT_SIZE: 1000,
  /** Maximum rows per bulk update/delete operation */
  MAX_BULK_OPERATION_SIZE: 1000,
} as const

/**
 * Plan-based table limits.
 */
export const TABLE_PLAN_LIMITS = {
  free: {
    maxTables: 3,
    maxRowsPerTable: 1000,
  },
  pro: {
    maxTables: 25,
    maxRowsPerTable: 5000,
  },
  team: {
    maxTables: 100,
    maxRowsPerTable: 10000,
  },
  enterprise: {
    maxTables: 10000,
    maxRowsPerTable: 1000000,
  },
} as const

export type PlanName = keyof typeof TABLE_PLAN_LIMITS

export interface TablePlanLimits {
  maxTables: number
  maxRowsPerTable: number
}

export const COLUMN_TYPES = ['string', 'number', 'boolean', 'date', 'json'] as const

export const NAME_PATTERN = /^[a-z_][a-z0-9_]*$/i

export const USER_TABLE_ROWS_SQL_NAME = 'user_table_rows'
