import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/table/rows/live-schema`.
 *
 * Defaults: `lockLiveTableSchema` and `withLiveSchema` return the definition they are handed, as
 * when its schema is still current, so no refit runs; `dropDeletedColumns` is a no-op and
 * `refitRowToSchema` reports a valid row.
 *
 * @example
 * ```ts
 * import { tableRowsLiveSchemaMockFns } from '@sim/testing/mocks/table-rows-live-schema.mock'
 *
 * tableRowsLiveSchemaMockFns.mockLockLiveTableSchema.mockResolvedValueOnce(liveTable)
 * ```
 */
export const tableRowsLiveSchemaMockFns = {
  mockLockLiveTableSchema: vi.fn(async <T>(_trx: unknown, table: T): Promise<T> => table),
  mockWithLiveSchema: vi.fn(<T>(table: T): T => table),
  mockDropDeletedColumns: vi.fn((..._args: unknown[]): void => {}),
  mockRefitRowToSchema: vi.fn((..._args: unknown[]) => ({ valid: true, errors: [] as string[] })),
}

/**
 * Static mock module for `@/lib/table/rows/live-schema`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/table/rows/live-schema', () => tableRowsLiveSchemaMock)
 * ```
 */
export const tableRowsLiveSchemaMock = {
  lockLiveTableSchema: tableRowsLiveSchemaMockFns.mockLockLiveTableSchema,
  withLiveSchema: tableRowsLiveSchemaMockFns.mockWithLiveSchema,
  dropDeletedColumns: tableRowsLiveSchemaMockFns.mockDropDeletedColumns,
  refitRowToSchema: tableRowsLiveSchemaMockFns.mockRefitRowToSchema,
}
