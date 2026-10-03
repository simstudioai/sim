import { vi } from 'vitest'

interface MockWireTable {
  id: string
  name: string
  description?: unknown
  schema: { columns: unknown[] }
  rowCount?: unknown
  maxRows?: unknown
  locks?: unknown
  workspaceId: string
  folderId?: string | null
  createdBy?: unknown
  createdAt: Date | string
  updatedAt: Date | string
  archivedAt?: Date | string | null
  jobStatus?: unknown
  jobId?: unknown
  jobType?: unknown
  jobError?: unknown
  jobRowsProcessed?: number
}

const mockNormalizeColumn = vi.fn((column: unknown): unknown => column)
const mockToWireTimestamp = vi.fn((value: Date | string): string =>
  value instanceof Date ? value.toISOString() : String(value)
)

/**
 * Controllable mock functions for `@/lib/table/wire`.
 *
 * Defaults: `normalizeColumn` is the identity (the dominant local stub; the real projection also
 * defaults `required`/`unique` and forwards type metadata from the column-type registry),
 * `toWireTimestamp` is the real ISO projection, and `toTableListItem` is the real list-item
 * projection routed through `mockNormalizeColumn` / `mockToWireTimestamp`.
 *
 * @example
 * ```ts
 * import { tableWireMockFns } from '@sim/testing/mocks/table-wire.mock'
 *
 * tableWireMockFns.mockNormalizeColumn.mockImplementation((c) => ({ ...c, required: false, unique: false }))
 * ```
 */
export const tableWireMockFns = {
  mockNormalizeColumn,
  mockToWireTimestamp,
  mockToTableListItem: vi.fn((table: MockWireTable) => ({
    id: table.id,
    name: table.name,
    description: table.description,
    schema: { columns: table.schema.columns.map((column) => mockNormalizeColumn(column)) },
    rowCount: table.rowCount,
    maxRows: table.maxRows,
    locks: table.locks,
    workspaceId: table.workspaceId,
    folderId: table.folderId ?? null,
    createdBy: table.createdBy,
    createdAt: mockToWireTimestamp(table.createdAt),
    updatedAt: mockToWireTimestamp(table.updatedAt),
    archivedAt: table.archivedAt ? mockToWireTimestamp(table.archivedAt) : null,
    jobStatus: table.jobStatus ?? null,
    jobId: table.jobId ?? null,
    jobType: table.jobType ?? null,
    jobError: table.jobError ?? null,
    jobRowsProcessed: table.jobRowsProcessed ?? 0,
  })),
}

/**
 * Static mock module for `@/lib/table/wire`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/table/wire', () => tableWireMock)
 * ```
 */
export const tableWireMock = {
  normalizeColumn: tableWireMockFns.mockNormalizeColumn,
  toWireTimestamp: tableWireMockFns.mockToWireTimestamp,
  toTableListItem: tableWireMockFns.mockToTableListItem,
}
