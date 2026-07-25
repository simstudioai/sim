/**
 * Saved views on a user table — named presets of `{ filter, sort, column layout }`.
 *
 * A view is presentation state, never an access boundary: it narrows what a
 * reader sees by default, but every row it hides is still reachable by switching
 * to "All". Row access is enforced entirely by the caller's workspace permission.
 *
 * "All" is the *absence* of a view, so no row is seeded per table and a table is
 * always reachable unfiltered even if every saved view is broken or deleted.
 */

import { db } from '@sim/db'
import { tableViews } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, asc, eq, ne } from 'drizzle-orm'
import { getColumnId } from '@/lib/table/column-keys'
import type { ColumnDefinition, TableViewConfig } from '@/lib/table/types'

const logger = createLogger('TableViewsService')

/** A saved view as returned to clients. */
export interface TableView {
  id: string
  tableId: string
  name: string
  config: TableViewConfig
  isDefault: boolean
  createdBy: string | null
  createdAt: Date
  updatedAt: Date
}

/** Raised when a view operation fails a user-correctable precondition. */
export class TableViewValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TableViewValidationError'
  }
}

/**
 * Drops references to columns that no longer exist from a stored config.
 *
 * `table_views.config` is a JSON blob with no foreign keys to the table schema,
 * so deleting a column leaves dangling ids behind. Rather than fan out writes to
 * every view on every column delete, stale ids are pruned here on read — the
 * stored blob stays as-is and self-heals on the next save.
 *
 * `filter` is deliberately left untouched: pruning a predicate would silently
 * widen the view's row set, which is worse than surfacing a filter the user can
 * see and remove. The filter builder already renders a stale column id as-is.
 */
export function pruneViewConfig(
  config: TableViewConfig,
  columns: ColumnDefinition[]
): TableViewConfig {
  const live = new Set(columns.map(getColumnId))
  const pruned: TableViewConfig = { ...config }

  if (config.columnOrder) pruned.columnOrder = config.columnOrder.filter((id) => live.has(id))
  if (config.pinnedColumns) pruned.pinnedColumns = config.pinnedColumns.filter((id) => live.has(id))
  if (config.hiddenColumns) pruned.hiddenColumns = config.hiddenColumns.filter((id) => live.has(id))
  if (config.columnWidths) {
    const widths: Record<string, number> = {}
    for (const [id, width] of Object.entries(config.columnWidths)) {
      if (live.has(id)) widths[id] = width
    }
    pruned.columnWidths = widths
  }
  if (config.sort) {
    const sort: Record<string, 'asc' | 'desc'> = {}
    for (const [id, direction] of Object.entries(config.sort)) {
      if (live.has(id)) sort[id] = direction
    }
    pruned.sort = Object.keys(sort).length > 0 ? sort : null
  }

  return pruned
}

function toTableView(row: typeof tableViews.$inferSelect, columns: ColumnDefinition[]): TableView {
  return {
    id: row.id,
    tableId: row.tableId,
    name: row.name,
    config: pruneViewConfig((row.config ?? {}) as TableViewConfig, columns),
    isDefault: row.isDefault,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/** Every view on a table, oldest first, with stale column references pruned. */
export async function listTableViews(
  tableId: string,
  columns: ColumnDefinition[]
): Promise<TableView[]> {
  const rows = await db
    .select()
    .from(tableViews)
    .where(eq(tableViews.tableId, tableId))
    .orderBy(asc(tableViews.createdAt), asc(tableViews.id))

  return rows.map((row) => toTableView(row, columns))
}

function normalizeName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) throw new TableViewValidationError('View name cannot be empty')
  return trimmed
}

export interface CreateTableViewData {
  tableId: string
  workspaceId: string
  name: string
  config: TableViewConfig
  userId: string
  columns: ColumnDefinition[]
}

export async function createTableView(data: CreateTableViewData): Promise<TableView> {
  const name = normalizeName(data.name)

  const [row] = await db
    .insert(tableViews)
    .values({
      id: generateId(),
      tableId: data.tableId,
      workspaceId: data.workspaceId,
      name,
      config: data.config,
      createdBy: data.userId,
    })
    .returning()

  logger.info('Created table view', { tableId: data.tableId, viewId: row.id })
  return toTableView(row, data.columns)
}

export interface UpdateTableViewData {
  viewId: string
  tableId: string
  name?: string
  config?: TableViewConfig
  isDefault?: boolean
  columns: ColumnDefinition[]
}

/**
 * Patches a view. `isDefault: true` clears the table's existing default in the
 * same transaction — the `table_views_table_default_unique` partial index rejects
 * a second default, so the clear cannot be skipped or reordered after the set.
 */
export async function updateTableView(data: UpdateTableViewData): Promise<TableView> {
  const patch: Partial<typeof tableViews.$inferInsert> = { updatedAt: new Date() }
  if (data.name !== undefined) patch.name = normalizeName(data.name)
  if (data.config !== undefined) patch.config = data.config
  if (data.isDefault !== undefined) patch.isDefault = data.isDefault

  const row = await db.transaction(async (tx) => {
    if (data.isDefault === true) {
      await tx
        .update(tableViews)
        .set({ isDefault: false })
        .where(
          and(
            eq(tableViews.tableId, data.tableId),
            eq(tableViews.isDefault, true),
            ne(tableViews.id, data.viewId)
          )
        )
    }

    const [updated] = await tx
      .update(tableViews)
      .set(patch)
      .where(and(eq(tableViews.id, data.viewId), eq(tableViews.tableId, data.tableId)))
      .returning()

    return updated
  })

  if (!row) throw new TableViewValidationError('View not found')

  return toTableView(row, data.columns)
}

/** Deleting the default simply leaves the table on "All". */
export async function deleteTableView(viewId: string, tableId: string): Promise<boolean> {
  const deleted = await db
    .delete(tableViews)
    .where(and(eq(tableViews.id, viewId), eq(tableViews.tableId, tableId)))
    .returning({ id: tableViews.id })

  if (deleted.length > 0) logger.info('Deleted table view', { tableId, viewId })
  return deleted.length > 0
}
