import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/table/rows/service`. Every function is a bare `vi.fn()`.
 *
 * @example
 * ```ts
 * import { tableRowsServiceMockFns } from '@sim/testing/mocks/table-rows-service.mock'
 *
 * tableRowsServiceMockFns.mockGetRowById.mockResolvedValue({ id: 'row-1', data: {}, executions: {} })
 * ```
 */
export const tableRowsServiceMockFns = {
  mockInsertRow: vi.fn(),
  mockBatchInsertRows: vi.fn(),
  mockBatchInsertRowsWithTx: vi.fn(),
  mockDispatchAfterBatchInsert: vi.fn(),
  mockReplaceTableRows: vi.fn(),
  mockReplaceTableRowsWithTx: vi.fn(),
  mockUpsertRow: vi.fn(),
  mockBuildSelectFindNameExpr: vi.fn(),
  mockFindRowMatches: vi.fn(),
  mockQueryRows: vi.fn(),
  mockFetchRowsBounded: vi.fn(),
  mockGetRowSummaryById: vi.fn(),
  mockGetRowById: vi.fn(),
  mockRequireTableRowIds: vi.fn(),
  mockUpdateRow: vi.fn(),
  mockDeleteRow: vi.fn(),
  mockUpdateRowsByFilter: vi.fn(),
  mockBatchUpdateRows: vi.fn(),
  mockDeleteRowsByFilter: vi.fn(),
  mockDeleteRowsByIds: vi.fn(),
}

/**
 * Static mock module for `@/lib/table/rows/service`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/table/rows/service', () => tableRowsServiceMock)
 * ```
 */
export const tableRowsServiceMock = {
  insertRow: tableRowsServiceMockFns.mockInsertRow,
  batchInsertRows: tableRowsServiceMockFns.mockBatchInsertRows,
  batchInsertRowsWithTx: tableRowsServiceMockFns.mockBatchInsertRowsWithTx,
  dispatchAfterBatchInsert: tableRowsServiceMockFns.mockDispatchAfterBatchInsert,
  replaceTableRows: tableRowsServiceMockFns.mockReplaceTableRows,
  replaceTableRowsWithTx: tableRowsServiceMockFns.mockReplaceTableRowsWithTx,
  upsertRow: tableRowsServiceMockFns.mockUpsertRow,
  buildSelectFindNameExpr: tableRowsServiceMockFns.mockBuildSelectFindNameExpr,
  findRowMatches: tableRowsServiceMockFns.mockFindRowMatches,
  queryRows: tableRowsServiceMockFns.mockQueryRows,
  fetchRowsBounded: tableRowsServiceMockFns.mockFetchRowsBounded,
  getRowSummaryById: tableRowsServiceMockFns.mockGetRowSummaryById,
  getRowById: tableRowsServiceMockFns.mockGetRowById,
  requireTableRowIds: tableRowsServiceMockFns.mockRequireTableRowIds,
  updateRow: tableRowsServiceMockFns.mockUpdateRow,
  deleteRow: tableRowsServiceMockFns.mockDeleteRow,
  updateRowsByFilter: tableRowsServiceMockFns.mockUpdateRowsByFilter,
  batchUpdateRows: tableRowsServiceMockFns.mockBatchUpdateRows,
  deleteRowsByFilter: tableRowsServiceMockFns.mockDeleteRowsByFilter,
  deleteRowsByIds: tableRowsServiceMockFns.mockDeleteRowsByIds,
}
