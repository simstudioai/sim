import { vi } from 'vitest'
import { tableBillingMock, tableBillingMockFns } from './table-billing.mock'
import { tableConstantsMock, tableConstantsMockFns } from './table-constants.mock'
import { tableJobsServiceMock, tableJobsServiceMockFns } from './table-jobs-service.mock'
import { tableRowsServiceMock, tableRowsServiceMockFns } from './table-rows-service.mock'
import { tableServiceMock, tableServiceMockFns } from './table-service.mock'

type MockTableQueryErrorCode =
  | 'TABLE_QUERY_RESULT_TOO_LARGE'
  | 'INVALID_CURSOR'
  | 'CURSOR_SORT_CONFLICT'
  | 'CURSOR_FILTER_CONFLICT'
  | 'INVALID_FILTER'
  | 'INVALID_ORDER'

interface MockColumnRef {
  id?: string
  name: string
}

interface MockCsvImportValidationDetails {
  missingRequired?: string[]
  duplicateTargets?: string[]
  unknownColumns?: string[]
  unknownHeaders?: string[]
}

/**
 * Stand-in for `TableQueryValidationError` from `@/lib/table/errors`: same `name`, message and
 * optional `code`. The real class also extends plain `Error`.
 */
export class MockTableQueryValidationError extends Error {
  readonly code?: MockTableQueryErrorCode

  constructor(message: string, code?: MockTableQueryErrorCode) {
    super(message)
    this.name = 'TableQueryValidationError'
    this.code = code
  }
}

/**
 * Stand-in for `TableRowTtlDisabledError` from `@/lib/table/errors`: same `name`,
 * `code: 'validation'`, `detailCode` and message. It extends `Error`, not the real
 * `OrchestrationError`, so code under test that checks `instanceof OrchestrationError` will not
 * match it; classifiers reading `.code` do.
 */
export class MockTableRowTtlDisabledError extends Error {
  readonly code = 'validation' as const
  readonly detailCode = 'TABLE_ROW_TTL_DISABLED'

  constructor() {
    super('Expiration columns are not enabled')
    this.name = 'TableRowTtlDisabledError'
  }
}

/**
 * Stand-in for `CsvImportValidationError` from `@/lib/table/import`: same `name`,
 * `code: 'CSV_IMPORT_VALIDATION'`, message and `details`.
 */
export class MockCsvImportValidationError extends Error {
  readonly code = 'CSV_IMPORT_VALIDATION' as const
  readonly details: MockCsvImportValidationDetails

  constructor(message: string, details: MockCsvImportValidationDetails = {}) {
    super(message)
    this.name = 'CsvImportValidationError'
    this.details = details
  }
}

/**
 * Stand-in for `TableViewValidationError` from `@/lib/table/views/service`: same `name` and
 * message.
 */
export class MockTableViewValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TableViewValidationError'
  }
}

const mockGetColumnId = vi.fn((column: MockColumnRef): string => column.id ?? column.name)

const mockBuildColumnIdByName = vi.fn((columns: readonly MockColumnRef[]): Map<string, string> => {
  const map = new Map<string, string>()
  for (const column of columns) map.set(column.name, column.id ?? column.name)
  return map
})

const mockBuildColumnNameById = vi.fn((columns: readonly MockColumnRef[]): Map<string, string> => {
  const map = new Map<string, string>()
  for (const column of columns) map.set(column.id ?? column.name, column.name)
  return map
})

/**
 * Controllable mock functions for the `@/lib/table` barrel. It spreads the fns of the central
 * mocks for the submodules the barrel re-exports — `table-billing`, `table-constants`,
 * `table-jobs-service`, `table-rows-service`, `table-service` — so e.g.
 * `tableMockFns.mockGetTableById === tableServiceMockFns.mockGetTableById`, and their defaults
 * apply here too.
 *
 * Defaults added here (real pure logic): `getColumnId` (`id ?? name`), `columnMatchesRef`,
 * `buildColumnIdByName`, `buildColumnNameById`, `buildIdByName`, `buildNameById`,
 * `rowDataNameToId` (keeps only names present in the map), `sanitizeName`, `resolveCurrencyCode`.
 * Every other function (column/view/workflow-group services, import parsing, validation, SQL
 * builders, query-builder converters, formatting helpers, `useFilterBuilder`) is a bare `vi.fn()`.
 *
 * @example
 * ```ts
 * import { tableMockFns } from '@sim/testing/mocks/table.mock'
 *
 * tableMockFns.mockGetTableById.mockResolvedValue({ id: 'table-1', workspaceId: 'ws-1' })
 * tableMockFns.mockAddTableColumn.mockResolvedValue(updatedTable)
 * ```
 */
export const tableMockFns = {
  ...tableBillingMockFns,
  ...tableConstantsMockFns,
  ...tableJobsServiceMockFns,
  ...tableRowsServiceMockFns,
  ...tableServiceMockFns,
  mockGetColumnId,
  mockGenerateColumnId: vi.fn(),
  mockColumnMatchesRef: vi.fn(
    (column: MockColumnRef, ref: string): boolean =>
      mockGetColumnId(column) === ref || column.name.toLowerCase() === ref.toLowerCase()
  ),
  mockWithGeneratedColumnIds: vi.fn(),
  mockRemapGroupColumnRefs: vi.fn(),
  mockBuildColumnIdByName,
  mockBuildColumnNameById,
  mockBuildIdByName: vi.fn(
    (schema: { columns: readonly MockColumnRef[] }): Map<string, string> =>
      mockBuildColumnIdByName(schema.columns)
  ),
  mockBuildNameById: vi.fn(
    (schema: { columns: readonly MockColumnRef[] }): Map<string, string> =>
      mockBuildColumnNameById(schema.columns)
  ),
  mockRemapViewConfigColumnRefs: vi.fn(),
  mockRowDataNameToId: vi.fn(
    (data: Record<string, unknown>, idByName: Map<string, string>): Record<string, unknown> => {
      const out: Record<string, unknown> = {}
      for (const [name, value] of Object.entries(data)) {
        const id = idByName.get(name)
        if (id !== undefined) out[id] = value
      }
      return out
    }
  ),
  mockFilterNamesToIds: vi.fn(),
  mockPredicateNamesToIds: vi.fn(),
  mockSortNamesToIds: vi.fn(),
  mockSortSpecNamesToIds: vi.fn(),
  mockUnknownColumnNames: vi.fn(),
  mockApplyPendingRename: vi.fn(),
  mockGetColumnRetypeScanBatchSize: vi.fn(),
  mockIsValueCompatibleWithColumn: vi.fn(),
  mockRetypeCellRewrite: vi.fn(),
  mockSelectValueForConversion: vi.fn(),
  mockAddTableColumn: vi.fn(),
  mockDeleteColumn: vi.fn(),
  mockDeleteColumns: vi.fn(),
  mockRenameColumn: vi.fn(),
  mockUpdateColumnConstraints: vi.fn(),
  mockUpdateColumnCurrency: vi.fn(),
  mockUpdateColumnOptions: vi.fn(),
  mockUpdateColumnType: vi.fn(),
  mockFormatCurrencyDisplay: vi.fn(),
  mockFormatCurrencyForInput: vi.fn(),
  mockGetCurrencyOptions: vi.fn(),
  mockIsSupportedCurrencyCode: vi.fn(),
  mockParseCurrencyInput: vi.fn(),
  mockResolveCurrencyCode: vi.fn((currencyCode?: string | null): string =>
    currencyCode ? currencyCode.toUpperCase() : 'USD'
  ),
  mockFormatDateCellDisplay: vi.fn(),
  mockIsCalendarDateString: vi.fn(),
  mockNormalizeDateCellValue: vi.fn(),
  mockStoredDateToEditable: vi.fn(),
  mockGenerateTableId: vi.fn(),
  mockAddImportColumns: vi.fn(),
  mockBulkInsertImportBatch: vi.fn(),
  mockDeleteAllTableRows: vi.fn(),
  mockImportAppendRows: vi.fn(),
  mockImportReplaceRows: vi.fn(),
  mockSetTableSchemaForImport: vi.fn(),
  mockBuildAutoMapping: vi.fn(),
  mockCoerceRowsForTable: vi.fn(),
  mockCoerceValue: vi.fn(),
  mockCreateCsvRejectionCollector: vi.fn(),
  mockCsvParseOptions: vi.fn(),
  mockDecodeCsvText: vi.fn(),
  mockDedupeHeaders: vi.fn(),
  mockInferColumnType: vi.fn(),
  mockInferSchemaFromCsv: vi.fn(),
  mockParseJsonRows: vi.fn(),
  mockSanitizeJsonHeaders: vi.fn(),
  mockSanitizeName: vi.fn((raw: string, fallbackPrefix = 'col'): string => {
    let name = raw
      .trim()
      .replace(/[^a-zA-Z0-9_]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '')
    if (!name || /^\d/.test(name)) name = `${fallbackPrefix}_${name}`
    return name
  }),
  mockValidateMapping: vi.fn(),
  mockDetectCsvDelimiter: vi.fn(),
  mockParseCsvBuffer: vi.fn(),
  mockParseFileRows: vi.fn(),
  mockEnrichTableToolDescription: vi.fn(),
  mockEnrichTableToolParameters: vi.fn(),
  mockFilterRulesToFilter: vi.fn(),
  mockFilterRulesToPredicate: vi.fn(),
  mockFilterToRules: vi.fn(),
  mockIsTablePredicate: vi.fn(),
  mockPredicateToFilter: vi.fn(),
  mockPredicateToFilterRules: vi.fn(),
  mockPruneFilterForColumns: vi.fn(),
  mockPrunePredicateForColumns: vi.fn(),
  mockSortRulesToSort: vi.fn(),
  mockSortRulesToSortSpec: vi.fn(),
  mockToLegacyFilter: vi.fn(),
  mockToLegacySort: vi.fn(),
  mockCollectPredicateFieldNames: vi.fn(),
  mockCollectSortFieldNames: vi.fn(),
  mockGetTablePredicateTreeSizeError: vi.fn(),
  mockNormalizeTablePredicate: vi.fn(),
  mockUseFilterBuilder: vi.fn(),
  mockBuildFilterClause: vi.fn(),
  mockBuildPredicateClause: vi.fn(),
  mockBuildSortClause: vi.fn(),
  mockEscapeLikePattern: vi.fn(),
  mockFieldPredicate: vi.fn(),
  mockCoerceRowToSchema: vi.fn(),
  mockCoerceRowValues: vi.fn(),
  mockGetUniqueColumns: vi.fn(),
  mockValidateColumnDefinition: vi.fn(),
  mockValidateRowAgainstSchema: vi.fn(),
  mockValidateRowSize: vi.fn(),
  mockValidateTableName: vi.fn(),
  mockValidateTableSchema: vi.fn(),
  mockValidateUniqueConstraints: vi.fn(),
  mockCheckBatchUniqueConstraintsDb: vi.fn(),
  mockCheckUniqueConstraintsDb: vi.fn(),
  mockValidateBatchRows: vi.fn(),
  mockValidateRowData: vi.fn(),
  mockResolveSelectOptionId: vi.fn(),
  mockSplitMultiSelectInput: vi.fn(),
  mockNormalizeStoredViewConfig: vi.fn(),
  mockNormalizeViewConfigForStorage: vi.fn(),
  mockPruneViewConfig: vi.fn(),
  mockViewConfigIdsToNames: vi.fn(),
  mockViewConfigNamesToIds: vi.fn(),
  mockCreateTableView: vi.fn(),
  mockDeleteTableView: vi.fn(),
  mockGetTableView: vi.fn(),
  mockListTableViews: vi.fn(),
  mockListTableViewsByWorkspace: vi.fn(),
  mockUpdateTableView: vi.fn(),
  mockAddWorkflowGroup: vi.fn(),
  mockAddWorkflowGroupOutput: vi.fn(),
  mockDeleteWorkflowGroup: vi.fn(),
  mockDeleteWorkflowGroupOutput: vi.fn(),
  mockPruneStaleWorkflowGroupOutputs: vi.fn(),
  mockUpdateWorkflowGroup: vi.fn(),
}

const fns = tableMockFns

/**
 * Static mock module for the `@/lib/table` barrel. It spreads `tableBillingMock`,
 * `tableConstantsMock`, `tableJobsServiceMock`, `tableRowsServiceMock` and `tableServiceMock`
 * (sharing their fns, constants and error classes), then adds the remaining re-exports. Constants
 * carry the real values; error classes are the `Mock*` stand-ins exported from this file.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/table', () => tableMock)
 * ```
 */
export const tableMock = {
  ...tableBillingMock,
  ...tableConstantsMock,
  ...tableJobsServiceMock,
  ...tableRowsServiceMock,
  ...tableServiceMock,
  TableQueryValidationError: MockTableQueryValidationError,
  TableRowTtlDisabledError: MockTableRowTtlDisabledError,
  CsvImportValidationError: MockCsvImportValidationError,
  TableViewValidationError: MockTableViewValidationError,
  DEFAULT_CURRENCY_CODE: 'USD',
  CSV_DELIMITER_CANDIDATES: [',', ';', '\t', '|'],
  CSV_DELIMITER_SNIFF_BYTES: 64 * 1024,
  CSV_MAX_RECORD_SIZE_BYTES: 1024 * 1024,
  MAX_REJECTED_SAMPLES: 5,
  CSV_SCHEMA_SAMPLE_SIZE: 100,
  CSV_MAX_BATCH_SIZE: 5000,
  CSV_MAX_BATCH_SIZE_BYTES: 5 * 1024 * 1024,
  CSV_SYNC_MAX_FILE_SIZE_BYTES: 25 * 1024 * 1024,
  CSV_SYNC_MAX_FILE_SIZE_MESSAGE: 'File exceeds maximum allowed size of 25 MB',
  CSV_DURABLE_MAX_FILE_SIZE_BYTES: 5 * 1024 * 1024 * 1024,
  CSV_DURABLE_MAX_FILE_SIZE_MESSAGE: 'File exceeds maximum allowed size of 5 GB',
  FILTER_OPERATIONS: new Set([
    'table_query_rows',
    'table_update_rows_by_filter',
    'table_delete_rows_by_filter',
  ]),
  DATA_OPERATIONS: new Set([
    'table_insert_row',
    'table_batch_insert_rows',
    'table_upsert_row',
    'table_update_row',
  ]),
  COMPARISON_OPERATORS: [
    { value: 'eq', label: 'equals' },
    { value: 'ne', label: 'not equals' },
    { value: 'contains', label: 'contains' },
    { value: 'ncontains', label: 'does not contain' },
    { value: 'startsWith', label: 'starts with' },
    { value: 'endsWith', label: 'ends with' },
    { value: 'gt', label: 'greater than' },
    { value: 'gte', label: 'greater or equal' },
    { value: 'lt', label: 'less than' },
    { value: 'lte', label: 'less or equal' },
    { value: 'in', label: 'in array' },
    { value: 'nin', label: 'not in array' },
    { value: 'isEmpty', label: 'is empty' },
    { value: 'isNotEmpty', label: 'is not empty' },
  ],
  VALUELESS_OPERATORS: new Set<string>(['isEmpty', 'isNotEmpty']),
  SINGLE_SELECT_FILTER_OPERATORS: new Set<string>([
    'eq',
    'ne',
    'in',
    'nin',
    'isEmpty',
    'isNotEmpty',
  ]),
  MULTI_SELECT_FILTER_OPERATORS: new Set<string>([
    'contains',
    'ncontains',
    'isEmpty',
    'isNotEmpty',
  ]),
  UI_TO_WIRE_OPERATOR: { isEmpty: '$empty', isNotEmpty: '$empty' } as Record<string, string>,
  LOGICAL_OPERATORS: [
    { value: 'and', label: 'and' },
    { value: 'or', label: 'or' },
  ],
  SORT_DIRECTION_OPTIONS: [
    { value: 'asc', label: 'ascending' },
    { value: 'desc', label: 'descending' },
  ],
  VALUELESS_OPS: new Set<string>(['isEmpty', 'isNotEmpty', 'isNull', 'isNotNull']),
  MAX_PREDICATE_GROUP_SIZE: 100,
  MAX_PREDICATE_DEPTH: 10,
  MAX_PREDICATE_NODES: 500,
  SINGLE_SELECT_OPERATORS: new Set<string>(['$eq', '$ne', '$in', '$nin', '$empty']),
  MULTI_SELECT_OPERATORS: new Set<string>(['$contains', '$ncontains', '$empty']),
  SINGLE_SELECT_OPS: new Set<string>([
    'eq',
    'ne',
    'in',
    'nin',
    'isEmpty',
    'isNotEmpty',
    'isNull',
    'isNotNull',
  ]),
  MULTI_SELECT_OPS: new Set<string>([
    'contains',
    'ncontains',
    'isEmpty',
    'isNotEmpty',
    'isNull',
    'isNotNull',
  ]),
  TABLE_LOCK_KINDS: ['schema', 'insert', 'update', 'delete'],
  TABLE_LOCK_FLAGS: {
    schema: 'schemaLocked',
    insert: 'insertLocked',
    update: 'updateLocked',
    delete: 'deleteLocked',
  },
  UNLOCKED_TABLE_LOCKS: {
    schemaLocked: false,
    insertLocked: false,
    updateLocked: false,
    deleteLocked: false,
  },
  getColumnId: fns.mockGetColumnId,
  generateColumnId: fns.mockGenerateColumnId,
  columnMatchesRef: fns.mockColumnMatchesRef,
  withGeneratedColumnIds: fns.mockWithGeneratedColumnIds,
  remapGroupColumnRefs: fns.mockRemapGroupColumnRefs,
  buildColumnIdByName: fns.mockBuildColumnIdByName,
  buildColumnNameById: fns.mockBuildColumnNameById,
  buildIdByName: fns.mockBuildIdByName,
  buildNameById: fns.mockBuildNameById,
  remapViewConfigColumnRefs: fns.mockRemapViewConfigColumnRefs,
  rowDataNameToId: fns.mockRowDataNameToId,
  filterNamesToIds: fns.mockFilterNamesToIds,
  predicateNamesToIds: fns.mockPredicateNamesToIds,
  sortNamesToIds: fns.mockSortNamesToIds,
  sortSpecNamesToIds: fns.mockSortSpecNamesToIds,
  unknownColumnNames: fns.mockUnknownColumnNames,
  applyPendingRename: fns.mockApplyPendingRename,
  getColumnRetypeScanBatchSize: fns.mockGetColumnRetypeScanBatchSize,
  isValueCompatibleWithColumn: fns.mockIsValueCompatibleWithColumn,
  retypeCellRewrite: fns.mockRetypeCellRewrite,
  selectValueForConversion: fns.mockSelectValueForConversion,
  addTableColumn: fns.mockAddTableColumn,
  deleteColumn: fns.mockDeleteColumn,
  deleteColumns: fns.mockDeleteColumns,
  renameColumn: fns.mockRenameColumn,
  updateColumnConstraints: fns.mockUpdateColumnConstraints,
  updateColumnCurrency: fns.mockUpdateColumnCurrency,
  updateColumnOptions: fns.mockUpdateColumnOptions,
  updateColumnType: fns.mockUpdateColumnType,
  formatCurrencyDisplay: fns.mockFormatCurrencyDisplay,
  formatCurrencyForInput: fns.mockFormatCurrencyForInput,
  getCurrencyOptions: fns.mockGetCurrencyOptions,
  isSupportedCurrencyCode: fns.mockIsSupportedCurrencyCode,
  parseCurrencyInput: fns.mockParseCurrencyInput,
  resolveCurrencyCode: fns.mockResolveCurrencyCode,
  formatDateCellDisplay: fns.mockFormatDateCellDisplay,
  isCalendarDateString: fns.mockIsCalendarDateString,
  normalizeDateCellValue: fns.mockNormalizeDateCellValue,
  storedDateToEditable: fns.mockStoredDateToEditable,
  generateTableId: fns.mockGenerateTableId,
  addImportColumns: fns.mockAddImportColumns,
  bulkInsertImportBatch: fns.mockBulkInsertImportBatch,
  deleteAllTableRows: fns.mockDeleteAllTableRows,
  importAppendRows: fns.mockImportAppendRows,
  importReplaceRows: fns.mockImportReplaceRows,
  setTableSchemaForImport: fns.mockSetTableSchemaForImport,
  buildAutoMapping: fns.mockBuildAutoMapping,
  coerceRowsForTable: fns.mockCoerceRowsForTable,
  coerceValue: fns.mockCoerceValue,
  createCsvRejectionCollector: fns.mockCreateCsvRejectionCollector,
  csvParseOptions: fns.mockCsvParseOptions,
  decodeCsvText: fns.mockDecodeCsvText,
  dedupeHeaders: fns.mockDedupeHeaders,
  inferColumnType: fns.mockInferColumnType,
  inferSchemaFromCsv: fns.mockInferSchemaFromCsv,
  parseJsonRows: fns.mockParseJsonRows,
  sanitizeJsonHeaders: fns.mockSanitizeJsonHeaders,
  sanitizeName: fns.mockSanitizeName,
  validateMapping: fns.mockValidateMapping,
  detectCsvDelimiter: fns.mockDetectCsvDelimiter,
  parseCsvBuffer: fns.mockParseCsvBuffer,
  parseFileRows: fns.mockParseFileRows,
  enrichTableToolDescription: fns.mockEnrichTableToolDescription,
  enrichTableToolParameters: fns.mockEnrichTableToolParameters,
  filterRulesToFilter: fns.mockFilterRulesToFilter,
  filterRulesToPredicate: fns.mockFilterRulesToPredicate,
  filterToRules: fns.mockFilterToRules,
  isTablePredicate: fns.mockIsTablePredicate,
  predicateToFilter: fns.mockPredicateToFilter,
  predicateToFilterRules: fns.mockPredicateToFilterRules,
  pruneFilterForColumns: fns.mockPruneFilterForColumns,
  prunePredicateForColumns: fns.mockPrunePredicateForColumns,
  sortRulesToSort: fns.mockSortRulesToSort,
  sortRulesToSortSpec: fns.mockSortRulesToSortSpec,
  toLegacyFilter: fns.mockToLegacyFilter,
  toLegacySort: fns.mockToLegacySort,
  collectPredicateFieldNames: fns.mockCollectPredicateFieldNames,
  collectSortFieldNames: fns.mockCollectSortFieldNames,
  getTablePredicateTreeSizeError: fns.mockGetTablePredicateTreeSizeError,
  normalizeTablePredicate: fns.mockNormalizeTablePredicate,
  useFilterBuilder: fns.mockUseFilterBuilder,
  buildFilterClause: fns.mockBuildFilterClause,
  buildPredicateClause: fns.mockBuildPredicateClause,
  buildSortClause: fns.mockBuildSortClause,
  escapeLikePattern: fns.mockEscapeLikePattern,
  fieldPredicate: fns.mockFieldPredicate,
  coerceRowToSchema: fns.mockCoerceRowToSchema,
  coerceRowValues: fns.mockCoerceRowValues,
  getUniqueColumns: fns.mockGetUniqueColumns,
  validateColumnDefinition: fns.mockValidateColumnDefinition,
  validateRowAgainstSchema: fns.mockValidateRowAgainstSchema,
  validateRowSize: fns.mockValidateRowSize,
  validateTableName: fns.mockValidateTableName,
  validateTableSchema: fns.mockValidateTableSchema,
  validateUniqueConstraints: fns.mockValidateUniqueConstraints,
  checkBatchUniqueConstraintsDb: fns.mockCheckBatchUniqueConstraintsDb,
  checkUniqueConstraintsDb: fns.mockCheckUniqueConstraintsDb,
  validateBatchRows: fns.mockValidateBatchRows,
  validateRowData: fns.mockValidateRowData,
  resolveSelectOptionId: fns.mockResolveSelectOptionId,
  splitMultiSelectInput: fns.mockSplitMultiSelectInput,
  normalizeStoredViewConfig: fns.mockNormalizeStoredViewConfig,
  normalizeViewConfigForStorage: fns.mockNormalizeViewConfigForStorage,
  pruneViewConfig: fns.mockPruneViewConfig,
  viewConfigIdsToNames: fns.mockViewConfigIdsToNames,
  viewConfigNamesToIds: fns.mockViewConfigNamesToIds,
  createTableView: fns.mockCreateTableView,
  deleteTableView: fns.mockDeleteTableView,
  getTableView: fns.mockGetTableView,
  listTableViews: fns.mockListTableViews,
  listTableViewsByWorkspace: fns.mockListTableViewsByWorkspace,
  updateTableView: fns.mockUpdateTableView,
  addWorkflowGroup: fns.mockAddWorkflowGroup,
  addWorkflowGroupOutput: fns.mockAddWorkflowGroupOutput,
  deleteWorkflowGroup: fns.mockDeleteWorkflowGroup,
  deleteWorkflowGroupOutput: fns.mockDeleteWorkflowGroupOutput,
  pruneStaleWorkflowGroupOutputs: fns.mockPruneStaleWorkflowGroupOutputs,
  updateWorkflowGroup: fns.mockUpdateWorkflowGroup,
}
