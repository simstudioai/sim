import type { SortSpec, TablePredicateInput, TableSchema, TableViewConfig } from '@/lib/table'
import { viewConfigIdsToNames, viewConfigNamesToIds } from '@/lib/table/views/service'

/**
 * The saved-view configuration the view tools accept, in the column-NAME
 * domain agents speak. Mirrors an entry of the table's views.json: `filter` and
 * `sort` may be `null` to clear them; `hiddenColumns` replaces the saved list.
 */
export interface TableViewToolConfig {
  filter?: TablePredicateInput | null
  sort?: SortSpec | null
  hiddenColumns?: string[]
}

/**
 * A saved view as every view tool returns it: column ids translated back to
 * names, layout-only fields (order, widths, pinned) omitted — the same shape
 * views.json presents, so the model reads one format everywhere.
 */
export function presentTableView(
  view: { id: string; name: string; isDefault: boolean; config: TableViewConfig },
  columns: TableSchema['columns']
) {
  const named = viewConfigIdsToNames(view.config, columns)
  return {
    id: view.id,
    name: view.name,
    isDefault: view.isDefault,
    filter: named.filter ?? null,
    sort: named.sort ?? null,
    hiddenColumns: named.hiddenColumns?.length ? named.hiddenColumns : undefined,
  }
}

export type PresentedTableView = ReturnType<typeof presentTableView>

/** Result envelope shared by create_table_view and edit_table_view. */
export interface TableViewToolResult {
  success: boolean
  message: string
  data?: {
    viewId: string
    tableId: string
    tableName: string
    view: PresentedTableView
  }
}

/** Whether a config argument names at least one part to write. */
export function hasViewConfigParts(config: TableViewToolConfig): boolean {
  return (
    config.filter !== undefined || config.sort !== undefined || config.hiddenColumns !== undefined
  )
}

/**
 * Builds the stored (id-domain) config from only the keys the caller sent. The
 * update path shallow-merges the result into the stored config, so an absent
 * part must stay absent — sending it as `null` silently wiped a view's saved
 * sort when only the filter changed (and vice versa); the docs promise "omit to
 * keep". Unknown column names are rejected by the translation.
 */
export function viewToolConfigToPatch(
  config: TableViewToolConfig,
  columns: TableSchema['columns']
): TableViewConfig {
  const patch: Record<string, unknown> = {}
  if (config.filter !== undefined) patch.filter = config.filter
  if (config.sort !== undefined) patch.sort = config.sort
  if (config.hiddenColumns !== undefined) patch.hiddenColumns = config.hiddenColumns
  return viewConfigNamesToIds(patch as TableViewConfig, columns)
}
