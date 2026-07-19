/**
 * React Query key factory for workspace interfaces.
 *
 * Lives in this standalone (non-`'use client'`) module — like
 * {@link file://./table-keys.ts} — so it can be imported from server
 * components (e.g. the interfaces page prefetch) without pulling in the
 * `'use client'` `@/hooks/queries/interfaces` module, whose exports would
 * otherwise resolve to client-reference stubs on the server.
 */

/** List scope for workspace interfaces — active (default) or archived (soft-deleted). */
export type InterfaceQueryScope = 'active' | 'archived'

export const interfaceKeys = {
  all: ['interfaces'] as const,
  lists: () => [...interfaceKeys.all, 'list'] as const,
  list: (workspaceId?: string, scope: InterfaceQueryScope = 'active') =>
    [...interfaceKeys.lists(), workspaceId ?? '', scope] as const,
  details: () => [...interfaceKeys.all, 'detail'] as const,
  detail: (id?: string) => [...interfaceKeys.details(), id ?? ''] as const,
}

export const INTERFACE_LIST_STALE_TIME = 30 * 1000
export const INTERFACE_DETAIL_STALE_TIME = 30 * 1000
