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
import { and, asc, eq, ne, sql } from 'drizzle-orm'
import { getColumnId } from '@/lib/table/column-keys'
import { NAME_PATTERN } from '@/lib/table/constants'
import { signalTableViewsChanged } from '@/lib/table/events'
import { filterRulesToPredicate, filterToRules } from '@/lib/table/query-builder/converters'
import type {
  ColumnDefinition,
  Filter,
  Predicate,
  PredicateNode,
  TableViewConfig,
} from '@/lib/table/types'

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
    const sort = config.sort.filter((s) => live.has(s.field))
    pruned.sort = sort.length > 0 ? sort : null
  }

  return pruned
}

/**
 * Migrates a config stored before the grammar switch. The feature never
 * released, so legacy-shaped rows exist only from pre-refactor testing: a
 * `$`-object filter converts through the builder-rule round-trip (its exact
 * authoring domain), and a `{col: dir}` sort record becomes an ordered spec.
 * Anything unconvertible is dropped rather than surfaced broken.
 */

/** Every leaf field in the tree is a plausible column id. */
function predicateFieldsAreValid(node: PredicateNode): boolean {
  if ('all' in node) return node.all.every(predicateFieldsAreValid)
  if ('any' in node) return node.any.every(predicateFieldsAreValid)
  return NAME_PATTERN.test((node as Predicate).field)
}

export function normalizeStoredViewConfig(raw: Record<string, unknown>): TableViewConfig {
  const config = { ...raw } as TableViewConfig
  const filter = raw.filter as Record<string, unknown> | null | undefined
  if (filter && !('all' in filter) && !('any' in filter)) {
    try {
      const converted = filterRulesToPredicate(filterToRules(filter as Filter))
      // The rule converters don't reject garbage — an unknown `$op` becomes a
      // rule on a column literally named `$op`. A converted leaf whose field
      // fails the column-name pattern proves the input wasn't builder-authored.
      config.filter = converted && predicateFieldsAreValid(converted) ? converted : null
    } catch {
      config.filter = null
    }
  }
  const sort = raw.sort as Record<string, 'asc' | 'desc'> | unknown[] | null | undefined
  if (sort && !Array.isArray(sort)) {
    config.sort = Object.entries(sort).map(([field, direction]) => ({ field, direction }))
  }
  return config
}

function toTableView(row: typeof tableViews.$inferSelect, columns: ColumnDefinition[]): TableView {
  return {
    id: row.id,
    tableId: row.tableId,
    name: row.name,
    config: pruneViewConfig(
      normalizeStoredViewConfig((row.config ?? {}) as Record<string, unknown>),
      columns
    ),
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
  // Views are table-wide shared state, so every open reader refetches the list live.
  signalTableViewsChanged(data.tableId)
  return toTableView(row, data.columns)
}

export interface UpdateTableViewData {
  viewId: string
  tableId: string
  name?: string
  /** Full replace — an explicit Save, where removing a filter must persist. */
  config?: TableViewConfig
  /** Shallow-merged into the stored config. Mutually exclusive with `config`. */
  configPatch?: TableViewConfig
  isDefault?: boolean
  columns: ColumnDefinition[]
}

/**
 * Patches a view. `isDefault: true` clears the table's existing default in the
 * same transaction — the `table_views_table_default_unique` partial index rejects
 * a second default, so the clear cannot be skipped or reordered after the set.
 *
 * `configPatch` merges in the database (`||`) rather than client-side, so two
 * overlapping partial writes — a column resize landing while a pin is in flight —
 * can't each replace the whole blob from their own stale snapshot.
 */
export async function updateTableView(data: UpdateTableViewData): Promise<TableView | null> {
  const patch: Partial<typeof tableViews.$inferInsert> = { updatedAt: new Date() }
  if (data.name !== undefined) patch.name = normalizeName(data.name)
  if (data.config !== undefined) patch.config = data.config
  if (data.configPatch !== undefined) {
    patch.config = sql`${tableViews.config} || ${JSON.stringify(data.configPatch)}::jsonb`
  }
  if (data.isDefault !== undefined) patch.isDefault = data.isDefault

  const row = await db.transaction(async (tx) => {
    // Confirm the target exists BEFORE demoting. The demotion has to run first —
    // the partial unique index rejects a second default — but on a PATCH naming a
    // missing view the target update matches nothing, so without this the demote
    // would still commit and silently clear the table's real default.
    const [existing] = await tx
      .select({ id: tableViews.id })
      .from(tableViews)
      .where(and(eq(tableViews.id, data.viewId), eq(tableViews.tableId, data.tableId)))
      .limit(1)
    if (!existing) return null

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

  // `null`, not a validation error: an absent view is a missing resource, and the
  // route maps it to 404 the same way `deleteTableView`'s `false` does.
  if (!row) return null

  // Only signal a real update — a no-op PATCH on a missing view (row === null) changed nothing.
  signalTableViewsChanged(data.tableId)
  return toTableView(row, data.columns)
}

/** Deleting the default simply leaves the table on "All". */
export async function deleteTableView(viewId: string, tableId: string): Promise<boolean> {
  const deleted = await db
    .delete(tableViews)
    .where(and(eq(tableViews.id, viewId), eq(tableViews.tableId, tableId)))
    .returning({ id: tableViews.id })

  if (deleted.length > 0) {
    logger.info('Deleted table view', { tableId, viewId })
    // Only signal a real deletion — a missing view (nothing deleted) changed nothing.
    signalTableViewsChanged(tableId)
  }
  return deleted.length > 0
}
