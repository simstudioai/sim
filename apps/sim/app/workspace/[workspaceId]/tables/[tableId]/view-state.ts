import type { TableViewWire } from '@/lib/api/contracts/tables'
import type { TableMetadata, TableViewConfig } from '@/lib/table'
import { ALL_VIEW_PARAM } from '@/app/workspace/[workspaceId]/tables/[tableId]/search-params'

export interface TableViewSelection {
  selectedView: TableViewWire | null
  defaultView: TableViewWire | null
  activeView: TableViewWire | null
}

/**
 * For fields shared with table metadata, a persisted view owns only what it has
 * stored. Missing fields inherit values written before table views were enabled.
 */
export function resolveTableViewConfig(
  metadata: TableMetadata | null | undefined,
  viewConfig: TableViewConfig | null
): TableViewConfig | null {
  if (!viewConfig) return null
  return { ...(metadata ?? {}), ...viewConfig }
}

/**
 * Resolves the persisted default synchronously when the URL has not selected a
 * view yet. The URL effect still records that choice, but render-time consumers
 * all see the same owner while that update is pending.
 */
export function resolveTableViewSelection(
  views: TableViewWire[],
  activeViewId: string | null
): TableViewSelection {
  let selectedView: TableViewWire | null = null
  let defaultView: TableViewWire | null = null
  for (const view of views) {
    if (view.id === activeViewId) selectedView = view
    if (view.isDefault) defaultView = view
  }
  return {
    selectedView,
    defaultView,
    activeView:
      selectedView ??
      (activeViewId === null || activeViewId === ALL_VIEW_PARAM ? defaultView : null),
  }
}

export interface TableViewRevision {
  id: string | null
  updatedAt: number | null
}

export interface TableViewPinTransition {
  nextViewId: string | null
  pendingCreatedViewId: string | null
}

/**
 * Resolves an external saved-view pin without leaving a locally created view
 * waiting for a URL selection that the pin is about to replace.
 */
export function resolveTableViewPinTransition(
  activeViewId: string | null,
  appliedViewId: string | null,
  pinnedViewId: string,
  pendingCreatedViewId: string | null
): TableViewPinTransition {
  if (activeViewId === pinnedViewId || appliedViewId === pinnedViewId) {
    return { nextViewId: null, pendingCreatedViewId }
  }
  return { nextViewId: pinnedViewId, pendingCreatedViewId: null }
}

export function getTableViewRevision(
  view: Pick<TableViewWire, 'id' | 'updatedAt'> | null
): TableViewRevision {
  return {
    id: view?.id ?? null,
    updatedAt: view?.updatedAt.getTime() ?? null,
  }
}

/**
 * Whether server state should replace the view configuration currently applied
 * to the grid. A different view always wins. The same view wins only when its
 * persisted revision advanced and no local autosave is still queued; older
 * query responses must never rewind a newer applied revision.
 */
export function shouldApplyTableViewRevision(
  applied: TableViewRevision,
  next: TableViewRevision,
  autosavePending: boolean
): boolean {
  if (applied.id !== next.id) return true
  if (autosavePending || next.updatedAt === null) return false
  return applied.updatedAt === null || next.updatedAt > applied.updatedAt
}
