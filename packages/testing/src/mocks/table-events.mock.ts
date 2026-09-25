import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/table/events`.
 *
 * Defaults: `appendTableEvent` resolves `null` (the real "Redis unavailable" result),
 * `getLatestTableEventId` resolves `0`, `readTableEventsSince` resolves `{ status: 'ok', events: [] }`,
 * and every `signal*` function is a no-op.
 *
 * @example
 * ```ts
 * import { tableEventsMockFns } from '@sim/testing/mocks/table-events.mock'
 *
 * expect(tableEventsMockFns.mockSignalTableRowsChanged).toHaveBeenCalledWith('table-1')
 * ```
 */
export const tableEventsMockFns = {
  mockAppendTableEvent: vi.fn(async (_event: unknown): Promise<unknown> => null),
  mockSignalTableRowsChanged: vi.fn((_tableId: string): void => {}),
  mockSignalTableRowsChangedByActor: vi.fn(
    (_tableId: string, _clientId: string | undefined): void => {}
  ),
  mockSignalTableSchemaChanged: vi.fn((_tableId: string): void => {}),
  mockSignalTableMetadataChanged: vi.fn((_tableId: string): void => {}),
  mockSignalTableViewsChanged: vi.fn((_tableId: string): void => {}),
  mockGetLatestTableEventId: vi.fn(async (_tableId: string): Promise<number> => 0),
  mockReadTableEventsSince: vi.fn(
    async (_tableId: string, _afterEventId: number): Promise<unknown> => ({
      status: 'ok',
      events: [],
    })
  ),
}

/**
 * Static mock module for `@/lib/table/events`. Constants carry the real values.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/table/events', () => tableEventsMock)
 * ```
 */
export const tableEventsMock = {
  TABLE_EVENT_TTL_SECONDS: 60 * 60,
  TABLE_EVENT_CAP: 5000,
  TABLE_EVENT_MAX_BYTES: 32 * 1024 * 1024,
  TABLE_EVENT_READ_CHUNK: 500,
  appendTableEvent: tableEventsMockFns.mockAppendTableEvent,
  signalTableRowsChanged: tableEventsMockFns.mockSignalTableRowsChanged,
  signalTableRowsChangedByActor: tableEventsMockFns.mockSignalTableRowsChangedByActor,
  signalTableSchemaChanged: tableEventsMockFns.mockSignalTableSchemaChanged,
  signalTableMetadataChanged: tableEventsMockFns.mockSignalTableMetadataChanged,
  signalTableViewsChanged: tableEventsMockFns.mockSignalTableViewsChanged,
  getLatestTableEventId: tableEventsMockFns.mockGetLatestTableEventId,
  readTableEventsSince: tableEventsMockFns.mockReadTableEventsSince,
}
