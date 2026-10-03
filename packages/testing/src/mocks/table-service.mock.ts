import { vi } from 'vitest'

/**
 * Stand-in for `TableConflictError` from `@/lib/table/service`: same `name`, `code: 'conflict'`,
 * and message. It extends `Error`, not the real `OrchestrationError`, so code under test that
 * checks `instanceof OrchestrationError` (rather than `TableConflictError` or `code`) will not
 * match it.
 */
export class MockTableConflictError extends Error {
  readonly code = 'conflict' as const

  constructor(name: string) {
    super(`A table named "${name}" already exists in this workspace`)
    this.name = 'TableConflictError'
  }
}

/**
 * Controllable mock functions for `@/lib/table/service`. Every function is a bare `vi.fn()`.
 *
 * @example
 * ```ts
 * import { tableServiceMockFns } from '@sim/testing/mocks/table-service.mock'
 *
 * tableServiceMockFns.mockGetTableById.mockResolvedValue({ id: 'table-1', workspaceId: 'ws-1' })
 * tableServiceMockFns.mockWithLockedTable.mockImplementation(async (_id, mutate) =>
 *   mutate(table, trx)
 * )
 * ```
 */
export const tableServiceMockFns = {
  mockWithLockedTable: vi.fn(),
  mockGetTableById: vi.fn(),
  mockListTables: vi.fn(),
  mockFindActiveTablesByExactName: vi.fn(),
  mockQueryTables: vi.fn(),
  mockAssertWorkspaceTableCapacity: vi.fn(),
  mockCreateTable: vi.fn(),
  mockAddTableColumnsWithTx: vi.fn(),
  mockAuditTableColumnsAdded: vi.fn(),
  mockRenameTable: vi.fn(),
  mockUpdateTableDescription: vi.fn(),
  mockMoveTableToFolder: vi.fn(),
  mockUpdateTableLocks: vi.fn(),
  mockUpdateTableMetadata: vi.fn(),
  mockDeleteTable: vi.fn(),
  mockRestoreTable: vi.fn(),
}

/**
 * Static mock module for `@/lib/table/service`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/table/service', () => tableServiceMock)
 * ```
 */
export const tableServiceMock = {
  TableConflictError: MockTableConflictError,
  withLockedTable: tableServiceMockFns.mockWithLockedTable,
  getTableById: tableServiceMockFns.mockGetTableById,
  listTables: tableServiceMockFns.mockListTables,
  findActiveTablesByExactName: tableServiceMockFns.mockFindActiveTablesByExactName,
  queryTables: tableServiceMockFns.mockQueryTables,
  assertWorkspaceTableCapacity: tableServiceMockFns.mockAssertWorkspaceTableCapacity,
  createTable: tableServiceMockFns.mockCreateTable,
  addTableColumnsWithTx: tableServiceMockFns.mockAddTableColumnsWithTx,
  auditTableColumnsAdded: tableServiceMockFns.mockAuditTableColumnsAdded,
  renameTable: tableServiceMockFns.mockRenameTable,
  updateTableDescription: tableServiceMockFns.mockUpdateTableDescription,
  moveTableToFolder: tableServiceMockFns.mockMoveTableToFolder,
  updateTableLocks: tableServiceMockFns.mockUpdateTableLocks,
  updateTableMetadata: tableServiceMockFns.mockUpdateTableMetadata,
  deleteTable: tableServiceMockFns.mockDeleteTable,
  restoreTable: tableServiceMockFns.mockRestoreTable,
}
