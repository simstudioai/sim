/**
 * React Query key factory for user-defined tables.
 *
 * Lives in this standalone (non-`'use client'`) module — like
 * {@link file://./folder-keys.ts} — so it can be imported from server
 * components (e.g. the tables page prefetch) without pulling in the
 * `'use client'` `@/hooks/queries/tables` module, whose exports would
 * otherwise resolve to client-reference stubs on the server.
 */

export type TableQueryScope = 'active' | 'archived' | 'all'

export const TABLE_LIST_STALE_TIME = 30 * 1000

export const tableKeys = {
  all: ['tables'] as const,
  lists: () => [...tableKeys.all, 'list'] as const,
  list: (workspaceId?: string, scope: TableQueryScope = 'active') =>
    [...tableKeys.lists(), workspaceId ?? '', scope] as const,
  details: () => [...tableKeys.all, 'detail'] as const,
  detail: (tableId: string) => [...tableKeys.details(), tableId] as const,
  exportJobs: (workspaceId?: string) =>
    [...tableKeys.all, 'export-jobs', workspaceId ?? ''] as const,
  rowsRoot: (tableId: string) => [...tableKeys.detail(tableId), 'rows'] as const,
  infiniteRows: (tableId: string, paramsKey: string) =>
    [...tableKeys.rowsRoot(tableId), 'infinite', paramsKey] as const,
  rowWrites: (tableId: string) => [...tableKeys.rowsRoot(tableId), 'write'] as const,
  find: (tableId: string, paramsKey: string) =>
    [...tableKeys.rowsRoot(tableId), 'find', paramsKey] as const,
  activeDispatches: (tableId: string) =>
    [...tableKeys.detail(tableId), 'active-dispatches'] as const,
  enrichmentDetails: (tableId: string) =>
    [...tableKeys.detail(tableId), 'enrichment-detail'] as const,
  enrichmentDetail: (tableId: string, rowId: string, groupId: string) =>
    [...tableKeys.enrichmentDetails(tableId), rowId, groupId] as const,
}
