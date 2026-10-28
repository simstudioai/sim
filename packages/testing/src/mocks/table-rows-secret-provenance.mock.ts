import { vi } from 'vitest'

const mockTableRowProvenanceReader = vi.fn()
const mockTableRowProvenanceReaderCapture = vi.fn(async (..._args: unknown[]): Promise<void> => {})
const mockTableRowProvenanceReaderExportProvenance = vi.fn(() => ({
  version: 1,
  complete: true,
  entries: [] as unknown[],
}))

/**
 * Stand-in for `TableRowProvenanceReader`. The constructor records `(scope, selectedColumnIds)`
 * on `mockTableRowProvenanceReader`; `capture` and `exportProvenance` delegate to their knobs.
 */
export class MockTableRowProvenanceReader {
  constructor(scope: unknown, selectedColumnIds?: unknown) {
    mockTableRowProvenanceReader(scope, selectedColumnIds)
  }

  capture(...args: unknown[]): Promise<void> {
    return mockTableRowProvenanceReaderCapture(...args)
  }

  exportProvenance() {
    return mockTableRowProvenanceReaderExportProvenance()
  }
}

/**
 * Controllable mock functions for `@/lib/table/rows/secret-provenance`.
 *
 * Defaults:
 * - `createExactEmptyTableRowSecretProvenance` / `createUnknownTableRowSecretProvenance` — the real
 *   pure constructors.
 * - `createTableRowSecretProvenanceFromRegistry` returns `{ complete: true, columns: {} }` (the
 *   dominant local stub; the real one filters a live registry).
 * - `mockTableRowProvenanceReaderCapture` resolves `undefined`;
 *   `mockTableRowProvenanceReaderExportProvenance` returns `{ version: 1, complete: true, entries: [] }`.
 * - Every other function is a bare `vi.fn()`.
 *
 * @example
 * ```ts
 * import { tableRowsSecretProvenanceMockFns } from '@sim/testing/mocks/table-rows-secret-provenance.mock'
 *
 * expect(tableRowsSecretProvenanceMockFns.mockTableRowProvenanceReader).toHaveBeenCalledWith(scope, undefined)
 * ```
 */
export const tableRowsSecretProvenanceMockFns = {
  mockClassifyTableRowSecretProvenanceForCopy: vi.fn(),
  mockCreateExactEmptyTableRowSecretProvenance: vi.fn((data: Record<string, unknown>) => ({
    complete: true,
    columns: Object.fromEntries(
      Object.keys(data).map((columnId) => [
        columnId,
        { version: 1, complete: true, entries: [] as unknown[] },
      ])
    ),
  })),
  mockCreateUnknownTableRowSecretProvenance: vi.fn(() => ({
    complete: false,
    columns: {} as Record<string, unknown>,
  })),
  mockCreateTableRowSecretProvenanceFromRegistry: vi.fn((_data: unknown, _registry: unknown) => ({
    complete: true,
    columns: {} as Record<string, unknown>,
  })),
  mockCreateTableRowSecretProvenanceFromEncryptedExecution: vi.fn(),
  mockMutateTableRowsWithSecretProvenance: vi.fn(),
  mockUpdateTableRowsWithDerivedSecretProvenance: vi.fn(),
  mockGetTableSnapshotModelMountSafety: vi.fn(),
  mockLoadTableRowSecretProvenance: vi.fn(),
  mockTableRowProvenanceReader,
  mockTableRowProvenanceReaderCapture,
  mockTableRowProvenanceReaderExportProvenance,
}

/**
 * Static mock module for `@/lib/table/rows/secret-provenance`. `TableRowProvenanceReader` is
 * {@link MockTableRowProvenanceReader}; `TABLE_ROW_SECRET_PROVENANCE_VERSION` is the real value.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/table/rows/secret-provenance', () => tableRowsSecretProvenanceMock)
 * ```
 */
export const tableRowsSecretProvenanceMock = {
  TABLE_ROW_SECRET_PROVENANCE_VERSION: 1,
  TableRowProvenanceReader: MockTableRowProvenanceReader,
  classifyTableRowSecretProvenanceForCopy:
    tableRowsSecretProvenanceMockFns.mockClassifyTableRowSecretProvenanceForCopy,
  createExactEmptyTableRowSecretProvenance:
    tableRowsSecretProvenanceMockFns.mockCreateExactEmptyTableRowSecretProvenance,
  createUnknownTableRowSecretProvenance:
    tableRowsSecretProvenanceMockFns.mockCreateUnknownTableRowSecretProvenance,
  createTableRowSecretProvenanceFromRegistry:
    tableRowsSecretProvenanceMockFns.mockCreateTableRowSecretProvenanceFromRegistry,
  createTableRowSecretProvenanceFromEncryptedExecution:
    tableRowsSecretProvenanceMockFns.mockCreateTableRowSecretProvenanceFromEncryptedExecution,
  mutateTableRowsWithSecretProvenance:
    tableRowsSecretProvenanceMockFns.mockMutateTableRowsWithSecretProvenance,
  updateTableRowsWithDerivedSecretProvenance:
    tableRowsSecretProvenanceMockFns.mockUpdateTableRowsWithDerivedSecretProvenance,
  getTableSnapshotModelMountSafety:
    tableRowsSecretProvenanceMockFns.mockGetTableSnapshotModelMountSafety,
  loadTableRowSecretProvenance: tableRowsSecretProvenanceMockFns.mockLoadTableRowSecretProvenance,
}
