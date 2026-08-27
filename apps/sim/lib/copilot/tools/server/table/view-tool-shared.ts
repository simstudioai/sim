import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { SortSpec, TablePredicateInput, TableSchema, TableViewConfig } from '@/lib/table'
import {
  TableViewValidationError,
  viewConfigIdsToNames,
  viewConfigNamesToIds,
} from '@/lib/table/views/service'

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
 * keep". An unknown column name is rejected here, in the adapter — outside the
 * use case that would classify it — so it is classified on the spot: unclassified,
 * the model gets a masked "system error" instead of the column it got wrong.
 */
export function viewToolConfigToPatch(
  config: TableViewToolConfig,
  columns: TableSchema['columns']
): TableViewConfig {
  const patch: Record<string, unknown> = {}
  if (config.filter !== undefined) patch.filter = config.filter
  if (config.sort !== undefined) patch.sort = config.sort
  if (config.hiddenColumns !== undefined) patch.hiddenColumns = config.hiddenColumns
  try {
    return viewConfigNamesToIds(patch as TableViewConfig, columns)
  } catch (error) {
    if (error instanceof TableViewValidationError) {
      throw new OrchestrationError('validation', error.message)
    }
    throw error
  }
}
