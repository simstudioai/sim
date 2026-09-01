/**
 * Saved views on a user table — named presets of `{ filter, sort, column layout }`.
 *
 * A view is presentation state, never an access boundary: it narrows what a
 * reader sees by default, but every row it hides remains accessible by clearing
 * the filter or selecting another view. Row access is enforced entirely by the
 * caller's workspace permission.
 *
 * New tables are seeded with an empty default view. Legacy tables without one
 * temporarily use "All" as an unfiltered fallback until they are migrated.
 */

import { db } from '@sim/db'
import { tableViews } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, asc, count, eq, ne, sql } from 'drizzle-orm'
import {
  buildColumnIdByName,
  getColumnId,
  remapViewConfigColumnRefs,
} from '@/lib/table/column-keys'
import { NAME_PATTERN, TABLE_LIMITS } from '@/lib/table/constants'
import { TableQueryValidationError } from '@/lib/table/errors'
import { signalTableViewsChanged } from '@/lib/table/events'
import type { DbTransaction } from '@/lib/table/planner'
import { filterRulesToPredicate, filterToRules } from '@/lib/table/query-builder/converters'
import {
  SYSTEM_COLUMN_FIELDS,
  validateStoragePredicate,
  validateStorageSortSpec,
} from '@/lib/table/query-builder/validate'
import { setTableTxTimeouts } from '@/lib/table/tx'
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
    // `live` holds column ids only. `createdAt`/`updatedAt`/`id` are sortable
    // row-level columns that are not in `schema.columns`, so without this a view
    // sorted by one of them would prune to "no sort at all" on every read.
    const sort = config.sort.filter((s) => live.has(s.field) || SYSTEM_COLUMN_FIELDS.has(s.field))
    pruned.sort = sort.length > 0 ? sort : null
  }

  return pruned
}

/**
 * Every column reference the row-selecting half of a stored config holds — each
 * `filter` leaf field and each `sort` field. Feeds the carried-forward exemption
 * in {@link normalizeViewConfigForStorage}, so it lists refs whether or not they
 * still resolve.
 */
function configColumnRefs(config: TableViewConfig): string[] {
  const refs: string[] = []
  for (const { field } of config.sort ?? []) refs.push(field)
  const visit = (node: PredicateNode): void => {
    if (!node || typeof node !== 'object') return
    if ('all' in node || 'any' in node) {
      const members = 'all' in node ? node.all : node.any
      if (Array.isArray(members)) for (const child of members) visit(child)
      return
    }
    if ('field' in node && typeof node.field === 'string') refs.push(node.field)
  }
  if (config.filter) visit(config.filter)
  return refs
}

/**
 * `name → id` for a view config, minus the names that already mean something
 * else as a reference.
 *
 * The rewrite is a lookup with pass-through, so a name entry would otherwise
 * beat the meaning a ref already has. A user column may legally be NAMED `id`,
 * `createdAt`, or `updatedAt` — nothing reserves those — and a legacy column
 * with no `id` has `getColumnId(col) === col.name`, so a rename can leave one
 * column's id equal to another's name. In both cases the write would rewrite the
 * ref to the user column while every read still resolves the literal to the
 * system row column or the original column, so the saved view would silently
 * sort or filter on something the caller did not name.
 */
function viewConfigRefMap(columns: readonly ColumnDefinition[]): Map<string, string> {
  const byName = buildColumnIdByName(columns)
  const liveIds = new Set(columns.map(getColumnId))
  for (const name of byName.keys()) {
    if (liveIds.has(name) || SYSTEM_COLUMN_FIELDS.has(name)) byName.delete(name)
  }
  return byName
}

/**
 * `columns` plus a placeholder for each exempt reference that no longer resolves,
 * so the shared query validators accept it without being taught about views. The
 * placeholders exist for the length of one validation call and are never stored.
 */
function tolerantColumns(
  columns: ColumnDefinition[],
  carriedForward: readonly string[]
): ColumnDefinition[] {
  if (carriedForward.length === 0) return columns
  const live = new Set(columns.map(getColumnId))
  const extra: ColumnDefinition[] = []
  for (const ref of carriedForward) {
    if (live.has(ref)) continue
    live.add(ref)
    extra.push({ id: ref, name: ref, type: 'string' })
  }
  return extra.length > 0 ? [...columns, ...extra] : columns
}

/**
 * Canonicalizes a caller-supplied config for storage: every column reference is
 * rewritten to the column's stable **id**, then the row-selecting parts are
 * validated against the live schema.
 *
 * Two vocabularies reach this write. The first-party UI authors ids; the v2
 * public surface is column-NAME-keyed like every other v2 row/data surface (see
 * `presentV2WorkflowGroup`, which converts the same way on the way out). The
 * rewrite is a lookup with pass-through, so an id, a system column, and a name
 * all land on the one keying `pruneViewConfig` and the query layer read.
 *
 * `filter` and `sort` are then validated: a predicate or sort naming no column
 * is one the query routes answer 400 for, so storing it would save a view that
 * can never load. Column LAYOUT is not validated by default — it auto-saves as
 * the user drags, and racing a concurrent column delete must self-heal through
 * {@link pruneViewConfig}, not fail the drag.
 *
 * `strictLayoutRefs` extends the same refusal to the LAYOUT keys, for the same
 * caller that gets it on `filter` and `sort`: one request naming an unknown
 * column twice answered 400 for the filter leaf and 200 for the hidden column,
 * whose name was then stored in a blob no read ever shows (`pruneViewConfig`
 * drops it) and would silently take effect if a column of that name were later
 * created. It stays off for the first-party grid, whose layout auto-saves as the
 * user drags and must self-heal past a concurrent column delete. A v2 caller
 * cannot carry a dangling layout ref forward: the read it echoes is pruned.
 *
 * `carriedForward` names the references that are exempt from that refusal.
 * Deleting a column leaves every view that filtered on it dangling —
 * `pruneViewConfig` deliberately does not prune a filter — so without the
 * exemption the filter becomes unwritable: changing one of its other conditions
 * autosaves the whole predicate and would be refused over the dangling condition
 * the user did not touch, with no way to save its eventual removal. The v2
 * surface exempts only what the STORED config
 * already held, so a reference the caller INTRODUCES is refused; a first-party
 * caller exempts its own refs too, which is the behavior the grid has always
 * had — see {@link CreateTableViewData.strictRefs}.
 *
 * The exemption is scoped to `filter` and `sort`, the only halves it exists for:
 * the layout check runs against the LIVE columns, not the tolerant set. A
 * carried-forward placeholder standing in for a deleted column named in the
 * stored filter must not also make that name a valid target for a new layout
 * ref, which `pruneViewConfig` would drop on the very next read — the same
 * write-accepts / read-discards asymmetry `strictLayoutRefs` closes. Validating
 * against `columns` makes the strict path accept exactly what a read keeps.
 */
export function normalizeViewConfigForStorage(
  config: TableViewConfig,
  columns: ColumnDefinition[],
  carriedForward: readonly string[] = [],
  strictLayoutRefs = false
): TableViewConfig {
  const stored = remapViewConfigColumnRefs(config, viewConfigRefMap(columns))
  const known = tolerantColumns(columns, carriedForward)
  try {
    if (stored.filter) validateStoragePredicate(stored.filter, known)
    if (stored.sort) validateStorageSortSpec(stored.sort, known)
  } catch (error) {
    if (error instanceof TableQueryValidationError) {
      throw new TableViewValidationError(error.message)
    }
    throw error
  }
  if (strictLayoutRefs) assertLayoutRefsResolve(stored, columns)
  return stored
}

/** The layout keys, paired with the references each one holds. */
function layoutRefEntries(config: TableViewConfig): Array<[string, readonly string[]]> {
  return [
    ['columnOrder', config.columnOrder ?? []],
    ['pinnedColumns', config.pinnedColumns ?? []],
    ['hiddenColumns', config.hiddenColumns ?? []],
    ['columnWidths', Object.keys(config.columnWidths ?? {})],
  ]
}

/**
 * Refuses a layout reference naming no column. Mirrors what the query
 * validators do for `filter` and `sort`, including the message shape, so one
 * config gets one answer whichever half the unknown name landed in.
 */
function assertLayoutRefsResolve(config: TableViewConfig, known: ColumnDefinition[]): void {
  const live = new Set(known.map(getColumnId))
  for (const [key, refs] of layoutRefEntries(config)) {
    for (const ref of refs) {
      if (!live.has(ref)) {
        throw new TableViewValidationError(
          `Unknown ${key} column "${ref}". It is not a column on this table.`
        )
      }
    }
  }
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

/**
 * The keys a stored config is allowed to contribute to a read.
 *
 * `table_views.config` is a schemaless JSONB blob, so a row written before a
 * key was retired — or by any writer that bypassed the contract — can carry
 * members the current shape does not declare. Spreading the blob wholesale
 * published them, and now that the config schemas are `.strict()` it would fail
 * the response parse and turn a legacy row into a 500. Projecting onto this
 * list makes the read canonical by construction.
 */
const STORED_VIEW_CONFIG_KEYS = [
  'columnWidths',
  'columnOrder',
  'pinnedColumns',
  'hiddenColumns',
  'filter',
  'sort',
] as const satisfies readonly (keyof TableViewConfig)[]

export function normalizeStoredViewConfig(raw: Record<string, unknown>): TableViewConfig {
  const picked: Record<string, unknown> = {}
  for (const key of STORED_VIEW_CONFIG_KEYS) {
    /**
     * `!= null`, not `!== undefined`: `table_views.config` is schemaless JSONB,
     * so a legacy row storing `{"columnOrder": null}` would otherwise survive
     * the pick and fail the declared response schema — turning a read into a
     * 500. An absent key and an explicitly null one mean the same thing here.
     */
    if (raw[key] != null) picked[key] = raw[key]
  }
  const config = picked as TableViewConfig
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
  } else if (Array.isArray(config.sort)) {
    /** Same reason as the key projection: a stored entry may carry more than the spec declares. */
    config.sort = config.sort.map(({ field, direction }) => ({ field, direction }))
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
  columns: ColumnDefinition[],
  workspaceId?: string
): Promise<TableView[]> {
  const rows = await db
    .select()
    .from(tableViews)
    .where(
      and(
        eq(tableViews.tableId, tableId),
        workspaceId ? eq(tableViews.workspaceId, workspaceId) : undefined
      )
    )
    .orderBy(asc(tableViews.createdAt), asc(tableViews.id))

  return rows.map((row) => toTableView(row, columns))
}

/** One view by id, scoped to its table, or `null` when it doesn't exist there. */
export async function getTableView(
  viewId: string,
  tableId: string,
  columns: ColumnDefinition[],
  workspaceId?: string
): Promise<TableView | null> {
  const [row] = await db
    .select()
    .from(tableViews)
    .where(
      and(
        eq(tableViews.id, viewId),
        eq(tableViews.tableId, tableId),
        workspaceId ? eq(tableViews.workspaceId, workspaceId) : undefined
      )
    )
    .limit(1)

  return row ? toTableView(row, columns) : null
}

function normalizeName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) throw new TableViewValidationError('View name cannot be empty')
  return trimmed
}

/**
 * Serializes the saved-view writers for one table on a transaction-scoped
 * advisory lock of their own, so a count-then-insert cannot be raced. Keyed
 * `user_table_views:<tableId>`, deliberately distinct from the
 * `user_table_schema:<tableId>` key the column/row mutators hold: presentation
 * state must not queue behind a schema rewrite.
 */
async function withTableViewsLock<T>(
  tableId: string,
  write: (trx: DbTransaction) => Promise<T>
): Promise<T> {
  return db.transaction(async (trx) => {
    await setTableTxTimeouts(trx)
    await trx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`user_table_views:${tableId}`}, 0))`
    )
    return write(trx)
  })
}

export interface CreateTableViewData {
  tableId: string
  workspaceId: string
  name: string
  config: TableViewConfig
  userId: string
  columns: ColumnDefinition[]
  /**
   * Make the new view the table's default, demoting the previous default in the
   * same transaction. The first view on a table is the default regardless — a
   * table that has views always keeps one.
   */
  isDefault?: boolean
  /**
   * Whether to refuse a filter, sort, or column-layout reference naming no live
   * column. Set by the `/api/v2` surface only, whose caller authored the config
   * in this request and can be told which reference was wrong.
   *
   * Absent — the first-party grid, which does not author these refs so much as
   * carry them: a view filtered on a since-deleted column keeps the dangling
   * leaf through every read (`pruneViewConfig` spares filters) and hands it
   * straight back on the next autosave. Refusing it would reject a config the
   * first-party grid already accepted, over a condition the user never touched.
   */
  strictRefs?: boolean
}

/**
 * Creates a saved view, refusing one that would push the table past
 * {@link TABLE_LIMITS.MAX_VIEWS_PER_TABLE}.
 *
 * The list read returns every view in one unpaginated page, so that promise only
 * holds if the write side enforces it. The count and the insert share an advisory
 * lock, which is what makes the count authoritative against a concurrent create
 * rather than a check two racing writers can both pass.
 *
 * The lock is keyed to this table's VIEWS, not to its schema. A view is
 * presentation state and contends only with another view create; taking the
 * schema lock would queue it behind a column rewrite or a bulk row job, whose
 * statement timeouts run far past this transaction's 3s `lock_timeout`, so
 * creating a view would fail for the duration of an unrelated long mutation.
 */
export async function createTableView(data: CreateTableViewData): Promise<TableView> {
  const name = normalizeName(data.name)
  const config = normalizeViewConfigForStorage(
    data.config,
    data.columns,
    data.strictRefs ? [] : configColumnRefs(data.config),
    data.strictRefs === true
  )

  const row = await withTableViewsLock(data.tableId, async (trx) => {
    const [existing] = await trx
      .select({ total: count() })
      .from(tableViews)
      .where(
        and(eq(tableViews.tableId, data.tableId), eq(tableViews.workspaceId, data.workspaceId))
      )

    const existingTotal = Number(existing?.total ?? 0)
    if (existingTotal >= TABLE_LIMITS.MAX_VIEWS_PER_TABLE) {
      throw new TableViewValidationError(
        `A table cannot have more than ${TABLE_LIMITS.MAX_VIEWS_PER_TABLE} saved views`
      )
    }

    // Demote before inserting — the partial unique index rejects a second
    // default, and the views lock keeps a concurrent promote from interleaving.
    if (data.isDefault === true && existingTotal > 0) {
      await trx
        .update(tableViews)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(
          and(
            eq(tableViews.tableId, data.tableId),
            eq(tableViews.workspaceId, data.workspaceId),
            eq(tableViews.isDefault, true)
          )
        )
    }

    const [created] = await trx
      .insert(tableViews)
      .values({
        id: generateId(),
        tableId: data.tableId,
        workspaceId: data.workspaceId,
        name,
        config,
        isDefault: data.isDefault === true || existingTotal === 0,
        createdBy: data.userId,
      })
      .returning()
    return created
  })

  logger.info('Created table view', { tableId: data.tableId, viewId: row.id })
  // Views are table-wide shared state, so every open reader refetches the list live.
  signalTableViewsChanged(data.tableId)
  return toTableView(row, data.columns)
}

export interface UpdateTableViewData {
  viewId: string
  tableId: string
  workspaceId?: string
  name?: string
  /** Full replacement for callers that own the complete configuration snapshot. */
  config?: TableViewConfig
  /** Shallow-merged into the stored config. Mutually exclusive with `config`. */
  configPatch?: TableViewConfig
  isDefault?: boolean
  columns: ColumnDefinition[]
  /** See {@link CreateTableViewData.strictRefs}. */
  strictRefs?: boolean
}

/**
 * Patches a view. `isDefault: true` clears the table's existing default in the
 * same transaction — the `table_views_table_default_unique` partial index rejects
 * a second default, so the clear cannot be skipped or reordered after the set.
 *
 * `configPatch` merges in the database (`||`) rather than client-side, so two
 * overlapping partial writes — a column resize landing while a pin is in flight —
 * can't each replace the whole blob from their own stale snapshot.
 *
 * The config is normalized inside the transaction, against the stored row, so
 * the references that row already carries stay writable — see
 * {@link normalizeViewConfigForStorage}.
 *
 * Every explicit default-state change contends with {@link createTableView}'s
 * default-on-create path, so promotions and demotions serialize on the same
 * per-table views lock. Plain patches (layout autosave, renames) touch only
 * their own row and skip the lock.
 */
export async function updateTableView(data: UpdateTableViewData): Promise<TableView | null> {
  const runWrite = <T>(write: (trx: DbTransaction) => Promise<T>): Promise<T> =>
    data.isDefault !== undefined ? withTableViewsLock(data.tableId, write) : db.transaction(write)
  const outcome = await runWrite(async (tx) => {
    // Confirm the target exists BEFORE demoting. The demotion has to run first —
    // the partial unique index rejects a second default — but on a PATCH naming a
    // missing view the target update matches nothing, so without this the demote
    // would still commit and silently clear the table's real default.
    const [existing] = await tx
      .select()
      .from(tableViews)
      .where(
        and(
          eq(tableViews.id, data.viewId),
          eq(tableViews.tableId, data.tableId),
          data.workspaceId ? eq(tableViews.workspaceId, data.workspaceId) : undefined
        )
      )
      .limit(1)
    if (!existing) return null

    const stored = configColumnRefs((existing.config ?? {}) as TableViewConfig)
    const carriedForward = data.strictRefs
      ? stored
      : [
          ...stored,
          ...configColumnRefs(data.config ?? {}),
          ...configColumnRefs(data.configPatch ?? {}),
        ]
    const config =
      data.config === undefined
        ? undefined
        : normalizeViewConfigForStorage(
            data.config,
            data.columns,
            carriedForward,
            data.strictRefs === true
          )
    const configPatch =
      data.configPatch === undefined
        ? undefined
        : normalizeViewConfigForStorage(
            data.configPatch,
            data.columns,
            carriedForward,
            data.strictRefs === true
          )

    const patch: Partial<typeof tableViews.$inferInsert> = { updatedAt: new Date() }
    if (data.name !== undefined) patch.name = normalizeName(data.name)
    if (config !== undefined) patch.config = config
    if (configPatch !== undefined) {
      patch.config = sql`${tableViews.config} || ${JSON.stringify(configPatch)}::jsonb`
    }
    if (data.isDefault !== undefined) patch.isDefault = data.isDefault

    const nextName = data.name === undefined ? existing.name : normalizeName(data.name)
    const storedConfig = (existing.config ?? {}) as TableViewConfig
    const nextConfig = config ?? (configPatch ? { ...storedConfig, ...configPatch } : storedConfig)
    const nextIsDefault = data.isDefault ?? existing.isDefault
    const changed =
      nextName !== existing.name ||
      JSON.stringify(nextConfig) !== JSON.stringify(storedConfig) ||
      nextIsDefault !== existing.isDefault
    if (!changed) return { row: existing, changed: false as const }

    if (data.isDefault === true) {
      await tx
        .update(tableViews)
        .set({ isDefault: false })
        .where(
          and(
            eq(tableViews.tableId, data.tableId),
            data.workspaceId ? eq(tableViews.workspaceId, data.workspaceId) : undefined,
            eq(tableViews.isDefault, true),
            ne(tableViews.id, data.viewId)
          )
        )
    }

    const [updated] = await tx
      .update(tableViews)
      .set(patch)
      .where(
        and(
          eq(tableViews.id, data.viewId),
          eq(tableViews.tableId, data.tableId),
          data.workspaceId ? eq(tableViews.workspaceId, data.workspaceId) : undefined
        )
      )
      .returning()

    return updated ? { row: updated, changed: true as const } : null
  })

  // `null`, not a validation error: an absent view is a missing resource, and the
  // route maps it to 404 the same way `deleteTableView`'s `false` does.
  if (!outcome) return null

  if (outcome.changed) signalTableViewsChanged(data.tableId)
  return toTableView(outcome.row, data.columns)
}

/**
 * Deleting the default while siblings remain simply leaves the table on "All".
 * The last remaining view is not deletable: a table that has views keeps at
 * least one, so it can never regress to the legacy zero-view state. Views of a
 * hard-deleted table are removed by the FK cascade, never through this path.
 * The sibling check and the delete share the views lock, so two racing deletes
 * cannot both observe a sibling and drop the table to zero.
 */
export async function deleteTableView(
  viewId: string,
  tableId: string,
  workspaceId?: string
): Promise<boolean> {
  const deleted = await withTableViewsLock(tableId, async (trx) => {
    const siblings = await trx
      .select({ id: tableViews.id })
      .from(tableViews)
      .where(
        and(
          eq(tableViews.tableId, tableId),
          workspaceId ? eq(tableViews.workspaceId, workspaceId) : undefined
        )
      )
    if (!siblings.some((view) => view.id === viewId)) return false
    if (siblings.length === 1) {
      throw new TableViewValidationError('A table must keep at least one saved view')
    }
    const result = await trx
      .delete(tableViews)
      .where(
        and(
          eq(tableViews.id, viewId),
          eq(tableViews.tableId, tableId),
          workspaceId ? eq(tableViews.workspaceId, workspaceId) : undefined
        )
      )
      .returning({ id: tableViews.id })
    return result.length > 0
  })

  if (deleted) {
    logger.info('Deleted table view', { tableId, viewId })
    // Only signal a real deletion — a missing view (nothing deleted) changed nothing.
    signalTableViewsChanged(tableId)
  }
  return deleted
}

/**
 * All of a workspace's views in one query, keyed by tableId — the snapshot
 * materializer's shape (per-table listTableViews would be N queries). Configs
 * are returned RAW (id-domain, unpruned); callers translate/prune with each
 * table's own columns.
 */
export async function listTableViewsByWorkspace(
  workspaceId: string
): Promise<Map<string, Array<typeof tableViews.$inferSelect>>> {
  const rows = await db
    .select()
    .from(tableViews)
    .where(eq(tableViews.workspaceId, workspaceId))
    .orderBy(asc(tableViews.createdAt), asc(tableViews.id))
  const byTable = new Map<string, Array<typeof tableViews.$inferSelect>>()
  for (const row of rows) {
    const list = byTable.get(row.tableId) ?? []
    list.push(row)
    byTable.set(row.tableId, list)
  }
  return byTable
}

function mapPredicateFields(
  node: PredicateNode,
  mapField: (field: string) => string
): PredicateNode {
  if ('all' in node) return { all: node.all.map((child) => mapPredicateFields(child, mapField)) }
  if ('any' in node) return { any: node.any.map((child) => mapPredicateFields(child, mapField)) }
  const leaf = node as Predicate
  return { ...leaf, field: mapField(leaf.field) }
}

/**
 * Stored (id-domain) view config → the column-NAME domain agents speak.
 * Unknown ids pass through unchanged, mirroring pruneViewConfig's philosophy
 * for filters: surfacing a stale reference beats silently widening the view.
 */
export function viewConfigIdsToNames(
  config: TableViewConfig,
  columns: ColumnDefinition[]
): TableViewConfig {
  const nameById = new Map(columns.map((col) => [getColumnId(col), col.name]))
  const toName = (field: string) => nameById.get(field) ?? field
  const out: TableViewConfig = { ...config }
  if (config.filter) out.filter = mapPredicateFields(config.filter, toName) as typeof config.filter
  if (config.sort) out.sort = config.sort.map((s) => ({ ...s, field: toName(s.field) }))
  if (config.hiddenColumns) out.hiddenColumns = config.hiddenColumns.map(toName)
  return out
}

/**
 * Agent-supplied (name-domain) view config → the id-domain stored shape.
 * Unknown column names are an error — a saved view with a dangling reference
 * is exactly the artifact this translation exists to prevent.
 */
export function viewConfigNamesToIds(
  config: TableViewConfig,
  columns: ColumnDefinition[]
): TableViewConfig {
  const idByName = new Map(columns.map((col) => [col.name, getColumnId(col)]))
  const unknown = new Set<string>()
  const toId = (field: string) => {
    const id = idByName.get(field)
    if (!id) {
      unknown.add(field)
      return field
    }
    return id
  }
  const out: TableViewConfig = { ...config }
  if (config.filter) out.filter = mapPredicateFields(config.filter, toId) as typeof config.filter
  if (config.sort) out.sort = config.sort.map((s) => ({ ...s, field: toId(s.field) }))
  if (config.hiddenColumns) out.hiddenColumns = config.hiddenColumns.map(toId)
  if (unknown.size > 0) {
    throw new TableViewValidationError(
      `Unknown column(s): ${[...unknown].join(', ')}. Use exact column names from get_schema.`
    )
  }
  return out
}
