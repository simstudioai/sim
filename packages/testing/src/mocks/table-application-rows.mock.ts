import { vi } from 'vitest'

/**
 * Stand-in for `TableRowsValidationError` from `@/lib/table/application/rows`: same `name`,
 * `code: 'validation'`, message and optional `details`. It extends `Error`, not the real
 * `OrchestrationError`, so code under test that checks `instanceof OrchestrationError` will not
 * match it; classifiers reading `.code` do.
 */
export class MockTableRowsValidationError extends Error {
  readonly code = 'validation' as const

  constructor(
    message: string,
    readonly details?: unknown
  ) {
    super(message)
    this.name = 'TableRowsValidationError'
  }
}

/**
 * Stand-in for `TableV2FeatureDisabledError`: same `name`, `code: 'forbidden'` and the real
 * `TABLE_QUERY_UNAVAILABLE_REASON` message. Not an `OrchestrationError` subclass.
 */
export class MockTableV2FeatureDisabledError extends Error {
  readonly code = 'forbidden' as const

  constructor() {
    super('The v2 table query API is not enabled for this workspace')
    this.name = 'TableV2FeatureDisabledError'
  }
}

/**
 * Stand-in for `ProjectedWireRowsValidationError`: subclass of
 * {@link MockTableRowsValidationError} with the real `name`.
 */
export class MockProjectedWireRowsValidationError extends MockTableRowsValidationError {
  constructor(message: string) {
    super(message)
    this.name = 'ProjectedWireRowsValidationError'
  }
}

/**
 * Controllable mock functions for `@/lib/table/application/rows`. Every function is a bare
 * `vi.fn()`. Each use case is exposed as its `execute` knob (`mock<UseCase>`) and its
 * `authorize` knob (`mock<UseCase>Authorize`).
 *
 * @example
 * ```ts
 * import { tableApplicationRowsMockFns } from '@sim/testing/mocks/table-application-rows.mock'
 *
 * tableApplicationRowsMockFns.mockQueryTableRows.mockResolvedValue({ table, rows: [], rowCount: 0 })
 * ```
 */
export const tableApplicationRowsMockFns = {
  mockTablePredicateNamesToFilter: vi.fn(),
  mockListTableRows: vi.fn(),
  mockListTableRowsAuthorize: vi.fn(),
  mockQueryTableRows: vi.fn(),
  mockQueryTableRowsAuthorize: vi.fn(),
  mockSearchTableRows: vi.fn(),
  mockSearchTableRowsAuthorize: vi.fn(),
  mockReadTableRow: vi.fn(),
  mockReadTableRowAuthorize: vi.fn(),
  mockReadTableRowEnrichmentDetail: vi.fn(),
  mockReadTableRowEnrichmentDetailAuthorize: vi.fn(),
  mockCreateTableRows: vi.fn(),
  mockCreateTableRowsAuthorize: vi.fn(),
  mockReplaceTableRows: vi.fn(),
  mockReplaceTableRowsAuthorize: vi.fn(),
  mockReplaceProjectedWireRows: vi.fn(),
  mockReplaceProjectedWireRowsAuthorize: vi.fn(),
  mockUpdateTableRow: vi.fn(),
  mockUpdateTableRowAuthorize: vi.fn(),
  mockUpdateTableRows: vi.fn(),
  mockUpdateTableRowsAuthorize: vi.fn(),
  mockBatchUpdateTableRows: vi.fn(),
  mockBatchUpdateTableRowsAuthorize: vi.fn(),
  mockDeleteTableRow: vi.fn(),
  mockDeleteTableRowAuthorize: vi.fn(),
  mockDeleteTableRows: vi.fn(),
  mockDeleteTableRowsAuthorize: vi.fn(),
  mockUpsertTableRow: vi.fn(),
  mockUpsertTableRowAuthorize: vi.fn(),
}

const fns = tableApplicationRowsMockFns

/**
 * Static mock module for `@/lib/table/application/rows`. Each use case is
 * `{ operation: { id }, authorize, execute }` with the real operation id.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/table/application/rows', () => tableApplicationRowsMock)
 * ```
 */
export const tableApplicationRowsMock = {
  TableRowsValidationError: MockTableRowsValidationError,
  TableV2FeatureDisabledError: MockTableV2FeatureDisabledError,
  ProjectedWireRowsValidationError: MockProjectedWireRowsValidationError,
  tablePredicateNamesToFilter: fns.mockTablePredicateNamesToFilter,
  listTableRows: {
    operation: { id: 'tables.rows.list' },
    authorize: fns.mockListTableRowsAuthorize,
    execute: fns.mockListTableRows,
  },
  queryTableRows: {
    operation: { id: 'tables.rows.query' },
    authorize: fns.mockQueryTableRowsAuthorize,
    execute: fns.mockQueryTableRows,
  },
  searchTableRows: {
    operation: { id: 'tables.rows.search' },
    authorize: fns.mockSearchTableRowsAuthorize,
    execute: fns.mockSearchTableRows,
  },
  readTableRow: {
    operation: { id: 'tables.rows.read' },
    authorize: fns.mockReadTableRowAuthorize,
    execute: fns.mockReadTableRow,
  },
  readTableRowEnrichmentDetail: {
    operation: { id: 'tables.rows.read' },
    authorize: fns.mockReadTableRowEnrichmentDetailAuthorize,
    execute: fns.mockReadTableRowEnrichmentDetail,
  },
  createTableRows: {
    operation: { id: 'tables.rows.create' },
    authorize: fns.mockCreateTableRowsAuthorize,
    execute: fns.mockCreateTableRows,
  },
  replaceTableRows: {
    operation: { id: 'tables.rows.replace' },
    authorize: fns.mockReplaceTableRowsAuthorize,
    execute: fns.mockReplaceTableRows,
  },
  replaceProjectedWireRows: {
    operation: { id: 'tables.rows.replace' },
    authorize: fns.mockReplaceProjectedWireRowsAuthorize,
    execute: fns.mockReplaceProjectedWireRows,
  },
  updateTableRow: {
    operation: { id: 'tables.rows.update' },
    authorize: fns.mockUpdateTableRowAuthorize,
    execute: fns.mockUpdateTableRow,
  },
  updateTableRows: {
    operation: { id: 'tables.rows.update_many' },
    authorize: fns.mockUpdateTableRowsAuthorize,
    execute: fns.mockUpdateTableRows,
  },
  batchUpdateTableRows: {
    operation: { id: 'tables.rows.update_many' },
    authorize: fns.mockBatchUpdateTableRowsAuthorize,
    execute: fns.mockBatchUpdateTableRows,
  },
  deleteTableRow: {
    operation: { id: 'tables.rows.delete' },
    authorize: fns.mockDeleteTableRowAuthorize,
    execute: fns.mockDeleteTableRow,
  },
  deleteTableRows: {
    operation: { id: 'tables.rows.delete_many' },
    authorize: fns.mockDeleteTableRowsAuthorize,
    execute: fns.mockDeleteTableRows,
  },
  upsertTableRow: {
    operation: { id: 'tables.rows.upsert' },
    authorize: fns.mockUpsertTableRowAuthorize,
    execute: fns.mockUpsertTableRow,
  },
}
