import { vi } from 'vitest'

const TABLE_LIMITS = {
  MAX_TABLES_PER_WORKSPACE: 100,
  MAX_ROWS_PER_TABLE: 10000,
  MAX_ROW_SIZE_BYTES: 400 * 1024,
  MAX_COLUMNS_PER_TABLE: 1000,
  MAX_TABLE_NAME_LENGTH: 128,
  MAX_COLUMN_NAME_LENGTH: 50,
  MAX_DESCRIPTION_LENGTH: 500,
  DEFAULT_QUERY_LIMIT: 100,
  MAX_QUERY_LIMIT: 1000,
  MAX_QUERY_RESULT_BYTES: 5 * 1024 * 1024,
  QUERY_BATCH_MAX_ROWS: 10000,
  UPDATE_BATCH_SIZE: 100,
  DELETE_BATCH_SIZE: 1000,
  DELETE_SNAPSHOT_BATCH_MAX_BYTES: 32 * 1024 * 1024,
  MAX_BATCH_INSERT_SIZE: 1000,
  MAX_BULK_OPERATION_SIZE: 1000,
  MAX_COPY_ROWS: 50000,
  DELETE_PAGE_SIZE: 10000,
  EXPORT_ASYNC_THRESHOLD_ROWS: 10000,
  MAX_EXCLUDE_ROW_IDS: 10000,
  MAX_ROW_RUN_STATE_BYTES: 2 * 1024 * 1024,
  MAX_FIND_MATCHES: 1000,
  MAX_VIEWS_PER_TABLE: 100,
  MAX_WORKFLOW_GROUPS_PER_TABLE: 100,
}

const DEFAULT_TABLE_PLAN_LIMITS = {
  free: { maxTables: 5, maxRowsPerTable: 50000 },
  pro: { maxTables: 100, maxRowsPerTable: 100000 },
  team: { maxTables: 1000, maxRowsPerTable: 500000 },
  enterprise: { maxTables: 10000, maxRowsPerTable: 1000000 },
}

/**
 * Controllable mock functions for `@/lib/table/constants`. Every default is the real function with
 * no env overrides set:
 * - `getMaxPageBytes` → `TABLE_LIMITS.MAX_QUERY_RESULT_BYTES` (5 MB)
 * - `getMaxRowSizeBytes` → `TABLE_LIMITS.MAX_ROW_SIZE_BYTES` (400 KB)
 * - `getDeleteSnapshotBatchSize` → the real formula over the two above (81)
 * - `getBillingDisabledTableLimits` → `Number.MAX_SAFE_INTEGER` for both caps
 * - `getTablePlanLimits` → a fresh copy of `DEFAULT_TABLE_PLAN_LIMITS`
 * - `generateUniqueTableName` → deterministic: `radiant_star`, else `radiant_star_<n>` for the
 *   first free `n` (the real one picks random space-themed words)
 *
 * @example
 * ```ts
 * import { tableConstantsMockFns } from '@sim/testing/mocks/table-constants.mock'
 *
 * tableConstantsMockFns.mockGetDeleteSnapshotBatchSize.mockReturnValue(500)
 * ```
 */
export const tableConstantsMockFns = {
  mockGetMaxPageBytes: vi.fn((): number => TABLE_LIMITS.MAX_QUERY_RESULT_BYTES),
  mockGetMaxRowSizeBytes: vi.fn((): number =>
    Math.min(TABLE_LIMITS.MAX_ROW_SIZE_BYTES, TABLE_LIMITS.DELETE_SNAPSHOT_BATCH_MAX_BYTES)
  ),
  mockGetDeleteSnapshotBatchSize: vi.fn((): number =>
    Math.max(
      1,
      Math.min(
        TABLE_LIMITS.DELETE_BATCH_SIZE,
        Math.floor(TABLE_LIMITS.DELETE_SNAPSHOT_BATCH_MAX_BYTES / TABLE_LIMITS.MAX_ROW_SIZE_BYTES)
      )
    )
  ),
  mockGetBillingDisabledTableLimits: vi.fn(() => ({
    maxTables: Number.MAX_SAFE_INTEGER,
    maxRowsPerTable: Number.MAX_SAFE_INTEGER,
  })),
  mockGetTablePlanLimits: vi.fn(() => structuredClone(DEFAULT_TABLE_PLAN_LIMITS)),
  mockGenerateUniqueTableName: vi.fn((existingNames: string[]): string => {
    const taken = new Set(existingNames.map((name) => name.toLowerCase()))
    if (!taken.has('radiant_star')) return 'radiant_star'
    let suffix = 1
    while (taken.has(`radiant_star_${suffix}`)) suffix++
    return `radiant_star_${suffix}`
  }),
}

/**
 * Static mock module for `@/lib/table/constants`. Constants carry the real values; `TABLE_LIMITS`
 * and `DEFAULT_TABLE_PLAN_LIMITS` are plain objects, so a file needing a smaller limit spreads
 * them: `vi.mock('@/lib/table/constants', () => ({ ...tableConstantsMock, TABLE_LIMITS: {
 * ...tableConstantsMock.TABLE_LIMITS, DELETE_PAGE_SIZE: 2 } }))`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/table/constants', () => tableConstantsMock)
 * ```
 */
export const tableConstantsMock = {
  MAX_TABLE_BATCH_ITEMS: 100,
  DEFAULT_TABLE_VIEW_NAME: 'Default',
  TABLE_LIMITS,
  DEFAULT_TABLE_PLAN_LIMITS,
  MAX_RUN_TARGET_ROW_IDS: DEFAULT_TABLE_PLAN_LIMITS.enterprise.maxRowsPerTable,
  COLUMN_TYPES: ['string', 'number', 'currency', 'boolean', 'date', 'ttl', 'json', 'select'],
  MAX_SELECT_OPTIONS: 100,
  FILTER_OPS: [
    'eq',
    'ne',
    'gt',
    'gte',
    'lt',
    'lte',
    'in',
    'nin',
    'contains',
    'ncontains',
    'startsWith',
    'endsWith',
    'like',
    'ilike',
    'nlike',
    'nilike',
    'isEmpty',
    'isNotEmpty',
    'isNull',
    'isNotNull',
  ],
  SORT_DIRECTIONS: ['asc', 'desc'],
  NAME_PATTERN: /^[A-Za-z_][A-Za-z0-9_]*$/,
  USER_TABLE_ROWS_SQL_NAME: 'user_table_rows',
  CSV_ASYNC_IMPORT_THRESHOLD_BYTES: 8 * 1024 * 1024,
  getMaxPageBytes: tableConstantsMockFns.mockGetMaxPageBytes,
  getMaxRowSizeBytes: tableConstantsMockFns.mockGetMaxRowSizeBytes,
  getDeleteSnapshotBatchSize: tableConstantsMockFns.mockGetDeleteSnapshotBatchSize,
  getBillingDisabledTableLimits: tableConstantsMockFns.mockGetBillingDisabledTableLimits,
  getTablePlanLimits: tableConstantsMockFns.mockGetTablePlanLimits,
  generateUniqueTableName: tableConstantsMockFns.mockGenerateUniqueTableName,
}
