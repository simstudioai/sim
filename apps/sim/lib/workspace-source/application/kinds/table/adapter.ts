/**
 * Tables as workspace source: `tables/<key>.ts` declares a table's name, description, folder and
 * columns, and opts its rows in with `rows` (`tables/<key>.rows.jsonl`). Every write goes through
 * the table use cases (`createTableUseCase`, `reshapeTableUseCase`, `deleteTableUseCase`), so
 * their authorization, locks, audit and schema-change signals apply; an update or adopt is one
 * reshape, which also writes the rows, so columns, rows and the managed mark commit whole or not
 * at all.
 *
 * Managed rows follow the three-way rule on their own fingerprint (`base.rows`): rows the
 * directory did not change are not read; changed ones are compared with the stored rows, which
 * are written only when the server's still match the base (else `E_APPLY_STALE`), and the apply
 * refuses a row version that moved since the plan. The reshape writes only the rows that differ,
 * matched by the key column (`writeKeyedRowsWithTx`): an unchanged row keeps its id and run state
 * and fires no trigger. Removing a stored row needs `--allow-delete`. Seed rows are inserted into
 * a table the apply creates, or adopts while it holds no rows. A table adopted by name (one the
 * directory never read) may only gain columns and rows into an empty table; any other change to
 * it is refused (`refuseUnreadAdopt`).
 */
import { mapWithConcurrency } from '@sim/utils/concurrency'
import { setOwn } from '@sim/workflow-code'
import {
  type BaseColumn,
  type BaseResource,
  fingerprintOf,
  type ResourceFingerprint,
  resourceAddress,
} from '@sim/workspace-code'
import {
  columnName,
  declaredRowKeyText,
  refusedTableRows,
  type TableDecl,
} from '@sim/workspace-code/kinds/table'
import {
  hasRowKey,
  rowKeyText,
  type TableRowsDecl,
  tableRowsFingerprint,
  tableRowsPath,
} from '@sim/workspace-code/kinds/table-rows'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { MAX_FOLDERS_PER_WORKSPACE } from '@/lib/folders/constants'
import { loadActiveFolderPathIndex } from '@/lib/folders/queries'
import { tableFolderPathForId } from '@/lib/table/application/folder-paths'
import {
  type ReshapeRows,
  type ReshapeTableInput,
  reshapeTableUseCase,
} from '@/lib/table/application/reshape'
import {
  createTableUseCase,
  deleteTableUseCase,
  listTableDefinitionsUseCase,
} from '@/lib/table/application/tables'
import { getColumnId } from '@/lib/table/column-keys'
import { getTableById } from '@/lib/table/service'
import type { RowData } from '@/lib/table/types'
import { validateRowSize } from '@/lib/table/validation'
import {
  DRIFT_HINT,
  GET_HINT,
  keyRenamedChange,
  kindFinding,
  missingFolderFinding,
  nameHolder,
  nameTakenFinding,
  planUndeclared,
  refuseDeclaredTwice,
} from '@/lib/workspace-source/application/findings'
import { bindStored, pendingOf } from '@/lib/workspace-source/application/keys'
import { tableCodec } from '@/lib/workspace-source/application/kinds/table/codec'
import {
  columnInput,
  diffTable,
  isColumnOp,
  type TableChanges,
} from '@/lib/workspace-source/application/kinds/table/diff'
import { checkColumnRenamesInUse } from '@/lib/workspace-source/application/kinds/table/renames'
import {
  baseRows,
  namedRows,
  readStoredRows,
  rowsVersion,
  StoredRowsOverLimitError,
  unkeyedRows,
} from '@/lib/workspace-source/application/kinds/table/rows'
import {
  printStoredTable,
  type StoredTableState,
  sourceColumns,
  storedFingerprint,
  tableAsDecl,
} from '@/lib/workspace-source/application/kinds/table/stored'
import {
  holdsIn,
  refuseUnreadAdopt,
  resolveDeclared,
  settle,
} from '@/lib/workspace-source/application/three-way'
import type {
  AppliedResource,
  KindAdapter,
  PlanContext,
  PlannedChange,
  SourceContext,
  StoredSet,
  WorkspaceSourceDiagnostic,
} from '@/lib/workspace-source/application/types'

/** What the apply does to a table's rows, decided at plan time. */
interface RowsPlan {
  /** The rows the reshape writes (only those that differ); absent leaves the rows alone. */
  write?: ReshapeRows
  /**
   * The rows mark to set (managed rows by key column name, or seed rows), or `null` to clear it;
   * absent leaves it.
   */
  mark?: RowsMark | null
  /** The row version the plan read the stored rows at; the apply refuses one that moved. */
  version?: number
}

/** How a declaration opts its rows in, as the table's mark records it. */
type RowsMark = { mode: 'managed'; keyColumn: string } | { mode: 'seed' }

/** What the apply carries out for one table, decided at plan time. */
export interface TablePlan {
  /** The changes an update or adopt makes; absent for a create or delete. */
  changes?: TableChanges
  /** The base's column bindings the plan's fingerprint was read under. */
  bindings?: Record<string, BaseColumn>
  /**
   * The base's rows entry, which the write records again when it cannot read the rows back
   * (see `written`); absent when the base held none for this table.
   */
  baseRows?: BaseResource['rows']
  rows?: RowsPlan
  /**
   * The column keys the write records (`metadata.sourceColumnKeys`), by stored column name: each
   * declared column whose key is not its name. Absent leaves the record alone.
   */
  keys?: Record<string, string>
}

type TableChange = PlannedChange<'table'>

/** The table folder paths a load read, so the plan that follows need not re-read them. */
const loadedFolders = new WeakMap<StoredSet<StoredTableState>, ReadonlySet<string>>()

async function folderIndex(workspaceId: string) {
  return loadActiveFolderPathIndex(workspaceId, 'table', undefined, {
    maxRows: MAX_FOLDERS_PER_WORKSPACE,
  })
}

/** Re-reads one table, refusing a table that left the workspace. */
async function reload(ctx: SourceContext, tableId: string): Promise<StoredTableState> {
  const table = await getTableById(tableId)
  if (!table || table.workspaceId !== ctx.workspace.workspaceId || table.archivedAt) {
    throw new OrchestrationError('not_found', 'The table no longer exists.')
  }
  const folders = await folderIndex(ctx.workspace.workspaceId)
  return { table, folderPath: tableFolderPathForId(folders, table.folderId) }
}

/** The column names `decl` declares, as the table stores them. */
function declaredColumnNames(decl: TableDecl): string[] {
  return Object.entries(decl.columns).map(([key, column]) => columnName(key, column))
}

/** What planning a table's rows found: the write, if any, and what the plan shows. */
interface RowsOutcome {
  plan?: RowsPlan
  fields: string[]
  /** Stored rows the write removes. */
  removed: number
  /** The base's rows entry a no-op records, read from the server. */
  base?: BaseResource['rows']
  /**
   * The stored rows (cells by column id) a planned managed write leaves as they are, their key
   * cell empty; absent when no managed rows are written.
   */
  kept?: RowData[]
  diagnostics: WorkspaceSourceDiagnostic[]
}

/** Each declared column's stored name, by column key. */
function namesByKey(decl: TableDecl): Map<string, string> {
  return new Map(
    Object.entries(decl.columns).map(([key, column]) => [key, columnName(key, column)])
  )
}

/** The keys `decl` gives its columns where a key is not the column's name, by column name. */
function declaredKeys(decl: TableDecl): Record<string, string> {
  const keys: Record<string, string> = {}
  for (const [key, column] of Object.entries(decl.columns)) {
    const name = columnName(key, column)
    if (name !== key) setOwn(keys, name, key)
  }
  return keys
}

/**
 * Whether a read of the stored table without a base (a fresh get, or a promotion's read of the
 * target) would print a declared column under another key than `decl` gives it.
 */
function keysUnrecorded(state: StoredTableState, decl: TableDecl): boolean {
  const { keyById } = tableAsDecl(state)
  const idByName = new Map(
    sourceColumns(state.table).map((column) => [column.name, getColumnId(column)])
  )
  return Object.entries(decl.columns).some(([key, column]) => {
    const id = idByName.get(columnName(key, column))
    return id !== undefined && keyById.get(id) !== key
  })
}

/**
 * `change` recording `decl`'s column keys: every table write records them, and a no-op becomes a
 * write of the record alone when a read without a base would print a column under another key.
 */
function withKeys(
  change: TableChange,
  state: StoredTableState,
  decl: TableDecl,
  entry: BaseResource | undefined
): TableChange {
  const keys = declaredKeys(decl)
  if (change.action === 'update' || change.action === 'adopt') {
    return { ...change, detail: { ...change.detail, keys } }
  }
  if (change.action !== 'noop' || !keysUnrecorded(state, decl)) return change
  const bindings = entry?.id === state.table.id ? entry.columns : undefined
  return {
    ...change,
    action: 'update',
    storedId: state.table.id,
    fields: ['column keys'],
    storedFingerprint: storedFingerprint(state, bindings),
    detail: { ...(bindings ? { bindings } : {}), keys },
  }
}

/** The rows mark a declaration asks for: managed rows by their key column's stored name, or seed. */
function markOf(decl: TableDecl): RowsMark | null {
  if (decl.rows?.mode === 'seed') return { mode: 'seed' }
  const key = decl.rows?.mode === 'managed' ? decl.rows.key : undefined
  const column = key !== undefined ? decl.columns[key] : undefined
  return key !== undefined && column
    ? { mode: 'managed', keyColumn: columnName(key, column) }
    : null
}

/** The reshape write of `decl`'s rows: a keyed diff for managed rows, inserts for seed rows. */
function rowsWrite(decl: TableDecl, allowDelete: boolean): ReshapeRows | undefined {
  const rows = decl.rows
  if (!rows) return undefined
  const named = namedRows(rows, namesByKey(decl))
  const mark = markOf(decl)
  return rows.mode === 'managed' && mark?.mode === 'managed'
    ? {
        mode: 'managed',
        keyColumn: mark.keyColumn,
        rows: named,
        columns: [...namesByKey(decl).values()],
        allowDelete,
      }
    : { mode: 'seed', rows: named }
}

/** `I_TABLE_ROWS_UNKEYED` for `count` stored rows of table `name` with an empty `rowKey` cell. */
function unkeyedFinding(
  key: string,
  name: string,
  rowKey: string,
  count: number
): WorkspaceSourceDiagnostic {
  return kindFinding(
    'table',
    key,
    'I_TABLE_ROWS_UNKEYED',
    `${count} row(s) of "${name}" have no "${rowKey}" value, so ${tableRowsPath(key)} leaves them out and an apply keeps them as they are.`,
    { hint: `Fill their "${rowKey}" cells in the table to manage them as source.` }
  )
}

/** How many refused rows a finding lists before it counts the rest. */
const LISTED_INVALID_ROWS = 5

/**
 * Refuses declared rows the declared columns cannot hold, checked at plan time as the write checks
 * them (`refusedTableRows`, which the CLI's offline check runs too), so a dry run fails where the
 * apply would and an apply fails before writing anything: each row within the size limit, coerced
 * to its columns' types and select options without blanking a value, with every required cell
 * filled, and no unique value repeated across the rows.
 */
function invalidRowsFinding(
  key: string,
  decl: TableDecl,
  rows: TableRowsDecl['data']
): WorkspaceSourceDiagnostic | undefined {
  const names = namesByKey(decl)
  const refused = refusedTableRows(decl, rows, (row) => {
    const named: RowData = {}
    for (const [column, value] of Object.entries(row)) named[names.get(column) ?? column] = value
    return validateRowSize(named).errors
  })
  if (refused.length === 0) return undefined
  const listed = refused
    .slice(0, LISTED_INVALID_ROWS)
    .map(({ row, errors }) => `row ${row + 1}: ${errors.join(', ')}`)
  const more = refused.length - listed.length
  return kindFinding(
    'table',
    key,
    'E_TABLE_ROWS',
    `${refused.length} row(s) of ${tableRowsPath(key)} do not fit the declared columns: ${listed.join('; ')}${more > 0 ? `; and ${more} more` : ''}.`,
    { file: tableRowsPath(key) }
  )
}

/**
 * The declared rows a `write` writes (every row of `decl`, renamed to stored names), refused as
 * {@link invalidRowsFinding} refuses them.
 */
function writeFindings(
  key: string,
  decl: TableDecl,
  write: ReshapeRows | undefined
): WorkspaceSourceDiagnostic[] {
  const finding = write ? invalidRowsFinding(key, decl, decl.rows?.data ?? []) : undefined
  return finding ? [finding] : []
}

/** The rows of a table the apply creates: every declared row, and the managed mark. */
function createRows(key: string, decl: TableDecl): RowsOutcome {
  const rows = decl.rows
  if (!rows) return { fields: [], removed: 0, diagnostics: [] }
  const mark = markOf(decl)
  const write = rows.data.length > 0 ? rowsWrite(decl, false) : undefined
  return {
    plan: {
      ...(write ? { write } : {}),
      ...(mark ? { mark } : {}),
    },
    fields: rows.data.length > 0 ? [`rows (${rows.mode} ${rows.data.length})`] : [],
    removed: 0,
    diagnostics: writeFindings(key, decl, write),
  }
}

/**
 * Plans an existing table's rows against what it stores: seed rows into an empty table the base
 * has not seen, managed rows by their own three-way rule, and the managed mark set or cleared.
 */
async function planRows(
  key: string,
  decl: TableDecl,
  state: StoredTableState,
  entry: BaseResource | undefined,
  ctx: PlanContext
): Promise<RowsOutcome> {
  const outcome: RowsOutcome = { fields: [], removed: 0, diagnostics: [] }
  const rows = decl.rows
  const { decl: storedDecl, keyById } = tableAsDecl(state, entry?.columns)
  const storedKey = storedDecl.rows?.key
  if (rows?.mode !== 'managed') {
    const storedMode = storedDecl.rows?.mode
    if (storedMode !== rows?.mode) {
      outcome.plan = { mark: markOf(decl) }
      outcome.fields.push(
        storedMode === 'managed'
          ? 'rows (no longer managed)'
          : rows
            ? 'rows (seed)'
            : 'rows (no longer seeded)'
      )
    }
    if (rows?.mode === 'seed' && rows.data.length > 0 && !entry) {
      if (state.table.rowCount === 0) {
        const write: ReshapeRows = { mode: 'seed', rows: namedRows(rows, namesByKey(decl)) }
        outcome.plan = { ...outcome.plan, write }
        outcome.fields.push(`rows (seed ${rows.data.length})`)
        outcome.diagnostics.push(...writeFindings(key, decl, write))
      } else {
        outcome.diagnostics.push(
          kindFinding(
            'table',
            key,
            'I_TABLE_SEED_SKIPPED',
            `Table "${state.table.name}" holds ${state.table.rowCount} row(s), so its seed rows are not written.`
          )
        )
      }
    }
    return outcome
  }
  const local = tableRowsFingerprint(rows)
  const based = entry?.id === state.table.id ? entry.rows : undefined
  const marked = storedKey === rows.key
  if (based && based.fingerprint === local && marked) {
    // Rows the directory leaves alone are not read, but a row version that moved says the server
    // wrote them since: drift the apply keeps, which the plan says.
    if ((await rowsVersion(ctx, state.table.id)) !== based.version) {
      outcome.diagnostics.push(
        kindFinding(
          'table',
          key,
          'W_SERVER_CHANGED',
          `The rows of table "${state.table.name}" were written on the server since this directory was read; the apply keeps the server's rows (not reverted to ${tableRowsPath(key)}).`,
          { hint: DRIFT_HINT }
        )
      )
    }
    return outcome
  }
  const rowKey = rows.key ?? ''
  const stored = await readStoredRows(ctx, state.table, keyById, rowKey)
  const kept = unkeyedRows(stored, rowKey)
  if (kept.length > 0) {
    outcome.diagnostics.push(unkeyedFinding(key, state.table.name, rowKey, kept.length))
  }
  const server = tableRowsFingerprint({ ...rows, data: stored.data })
  if (server === local) {
    if (!marked) outcome.plan = { mark: markOf(decl), version: stored.version }
    else outcome.base = baseRows(rows, stored.version)
    return outcome
  }
  // The base recorded the rows under the key the server still marks, which this apply may change.
  const serverAsBased =
    storedKey !== undefined && storedKey !== rows.key
      ? tableRowsFingerprint({ mode: 'managed', key: storedKey, data: stored.data })
      : server
  if (based && serverAsBased !== based.fingerprint) {
    outcome.diagnostics.push(
      kindFinding(
        'table',
        key,
        'E_APPLY_STALE',
        `The rows of table "${state.table.name}" changed on the server since this directory was read.`,
        { hint: 'Run `sim workspaces source get` to read them, then apply your edits again.' }
      )
    )
    return outcome
  }
  const declared = new Set(rows.data.map((row) => declaredRowKeyText(decl, row)))
  outcome.removed = stored.data.filter(
    (row) => hasRowKey(row, rowKey) && !declared.has(rowKeyText(row[rowKey]))
  ).length
  if (outcome.removed > 0 && !ctx.allowDelete) {
    outcome.diagnostics.push(
      kindFinding(
        'table',
        key,
        'E_APPLY_DELETE_NOT_ALLOWED',
        `This removes ${outcome.removed} row(s) of "${state.table.name}" that ${tableRowsPath(key)} no longer lists.`,
        { hint: 'Pass --allow-delete to apply it, or keep the rows listed.' }
      )
    )
  }
  const write = rowsWrite(decl, ctx.allowDelete)
  outcome.plan = {
    write,
    ...(marked ? {} : { mark: markOf(decl) }),
    version: stored.version,
  }
  outcome.kept = kept
  outcome.fields.push(`rows (${rows.data.length})`)
  outcome.diagnostics.push(...writeFindings(key, decl, write))
  return outcome
}

/**
 * The fingerprint a planned write is checked against: the table's, and the row version its rows
 * were read at when it writes them.
 */
function planFingerprint(
  table: ResourceFingerprint,
  rows: RowsPlan | undefined
): ResourceFingerprint {
  return rows?.version === undefined ? table : fingerprintOf({ table, rowsVersion: rows.version })
}

/** `change`, a table no-op, carrying out what planning its rows found. */
function withRows(
  change: TableChange,
  rows: RowsOutcome,
  state: StoredTableState,
  entry: BaseResource | undefined
): TableChange {
  change.diagnostics.push(...rows.diagnostics)
  if (rows.plan) {
    const based = entry?.id === state.table.id ? entry : undefined
    const bindings = based?.columns
    return {
      ...change,
      action: 'update',
      fields: rows.fields,
      ...(rows.removed > 0
        ? { destructive: { what: 'rows', counts: { rows: rows.removed } } }
        : {}),
      storedFingerprint: planFingerprint(storedFingerprint(state, bindings), rows.plan),
      detail: {
        ...(bindings ? { bindings } : {}),
        ...(based?.rows ? { baseRows: based.rows } : {}),
        rows: rows.plan,
      },
    }
  }
  if (!rows.base) return change
  const recorded = change.base ?? entry ?? printStoredTable(state, change.key).base
  return { ...change, base: { ...recorded, rows: rows.base } }
}

/**
 * The declared column names the stored table no longer holds under the same column: a table whose
 * declaration is unchanged writes no columns, so its rows are written by the names the server
 * holds, and a column renamed or removed there since the base would silently drop its cells.
 */
function columnsRenamedOnServer(
  decl: TableDecl,
  state: StoredTableState,
  entry: BaseResource | undefined
): string[] {
  const { decl: storedDecl } = tableAsDecl(state, entry?.columns)
  return Object.entries(decl.columns).flatMap(([key, column]) => {
    const stored = storedDecl.columns[key]
    const name = columnName(key, column)
    return stored && columnName(key, stored) === name ? [] : [name]
  })
}

/**
 * What adopting a table would change or remove of what it holds (see `refuseUnreadAdopt`): every
 * table and column change but an added column, and the rows when it writes over stored ones or
 * stops managing them. Rows written into an empty table only add to it.
 */
function changedOnAdopt(
  changes: TableChanges,
  rows: RowsOutcome,
  state: StoredTableState
): string[] {
  const fields = changes.fields.filter((field) => !changes.additions.includes(field))
  const rowsChanged =
    rows.plan !== undefined &&
    state.table.rowCount > 0 &&
    (rows.plan.write !== undefined || rows.plan.mark === null)
  return rowsChanged ? [...fields, ...rows.fields] : fields
}

async function planTable(
  key: string,
  decl: TableDecl,
  stored: StoredSet<StoredTableState>,
  desired: ReadonlyMap<string, TableDecl>,
  ctx: PlanContext,
  folders: ReadonlySet<string>
): Promise<TableChange> {
  const change: TableChange = { kind: 'table', key, action: 'noop', decl, diagnostics: [] }
  const missingFolder = missingFolderFinding('table', key, decl.folder, folders)
  if (missingFolder) change.diagnostics.push(missingFolder)
  const entry = ctx.base?.resources[resourceAddress('table', key)]
  const resolution = resolveDeclared({
    local: fingerprintOf(tableCodec.canonical(decl)),
    stored: stored.bound.get(key),
    adoptable: stored.unbound.find(
      (candidate) => candidate.name.toLowerCase() === decl.name.toLowerCase()
    ),
    base: entry,
    fingerprint: (resource, entry) => storedFingerprint(resource.state, entry?.columns),
    holds: holdsIn(stored),
  })
  const planned = settle(
    resolution,
    change,
    (resource) =>
      printStoredTable(resource.state, key, entry?.id === resource.id ? entry.columns : undefined)
        .base
  )
  if ('settled' in planned) {
    // A table whose declaration is unchanged can still hold rows to write.
    const settled = planned.settled
    const resource = resolution.action === 'noop' ? resolution.stored : undefined
    if (!resource || settled.action !== 'noop') return settled
    if (!decl.rows && !resource.state.table.metadata?.sourceRows) {
      return withKeys(settled, resource.state, decl, entry)
    }
    const rows = await planRows(key, decl, resource.state, entry, ctx)
    const renamed = rows.plan?.write ? columnsRenamedOnServer(decl, resource.state, entry) : []
    if (renamed.length > 0) {
      settled.diagnostics.push(
        kindFinding(
          'table',
          key,
          'E_APPLY_STALE',
          `Column(s) ${renamed.map((name) => `"${name}"`).join(', ')} of table "${resource.state.table.name}" were renamed or removed on the server since this directory was read, so its rows cannot be written by those names.`,
          { hint: GET_HINT }
        )
      )
      return settled
    }
    return withKeys(withRows(settled, rows, resource.state, entry), resource.state, decl, entry)
  }
  switch (planned.action) {
    case 'create': {
      const holder = nameHolder(stored, decl.name, { fold: true })
      if (holder) {
        const renamed = keyRenamedChange(change, holder, desired, ctx)
        if (renamed) return renamed
        change.diagnostics.push(nameTakenFinding('table', key, decl.name, holder))
      }
      const rows = createRows(key, decl)
      change.diagnostics.push(...rows.diagnostics)
      return {
        ...change,
        action: 'create',
        fields: [
          ...Object.keys(decl.columns).map((column) => `columns.${column} (add)`),
          ...rows.fields,
        ],
        pending: pendingOf({ ...change, action: 'create' }, { columns: declaredColumnNames(decl) }),
        detail: { rows: rows.plan, keys: declaredKeys(decl) },
      }
    }
    case 'adopt':
    case 'update': {
      const { state } = planned.stored
      const holder = nameHolder(stored, decl.name, { self: planned.stored.id, fold: true })
      if (holder) change.diagnostics.push(nameTakenFinding('table', key, decl.name, holder))
      const bindings = planned.action === 'update' ? planned.base.columns : undefined
      const rows = await planRows(
        key,
        decl,
        state,
        planned.action === 'update' ? planned.base : undefined,
        ctx
      )
      const changes = await diffTable(key, decl, state, bindings, rows.kept)
      if (planned.action === 'adopt') {
        const refused = refuseUnreadAdopt(
          change,
          planned.stored,
          changedOnAdopt(changes, rows, state)
        )
        if (refused) return refused
      }
      change.diagnostics.push(...changes.diagnostics, ...rows.diagnostics)
      const changed =
        changes.columns.length > 0 || changes.fields.length > 0 || rows.plan !== undefined
      const locked = lockFinding(key, state, changes)
      if (locked) change.diagnostics.push(locked)
      const dropped = changes.columns.filter((column) => column.op === 'drop').length
      if ((dropped > 0 || changes.lostCells > 0) && !ctx.allowDelete) {
        const losses = [
          ...(dropped > 0 ? [`drops ${dropped} column(s)`] : []),
          ...(changes.lostCells > 0 && changes.removedOptions > 0
            ? [`removes ${changes.removedOptions} select option(s)`]
            : []),
        ]
        change.diagnostics.push(
          kindFinding(
            'table',
            key,
            'E_APPLY_DELETE_NOT_ALLOWED',
            `This ${losses.join(' and ')} of "${state.table.name}"${changes.lostCells > 0 ? `, losing ${changes.lostCells} cell(s)` : ''}.`,
            { hint: 'Pass --allow-delete to apply it, or keep the columns and options declared.' }
          )
        )
      }
      const action = planned.action === 'adopt' ? 'adopt' : changed ? 'update' : 'noop'
      const storedId = planned.stored.id
      const entryOfStored = planned.action === 'update' ? planned.base : undefined
      return withKeys(
        {
          ...change,
          action,
          storedId,
          // A later workflow's dry run checks its row writes against the columns this declares.
          ...(action !== 'noop'
            ? {
                pending: pendingOf(
                  { ...change, action, storedId },
                  { columns: declaredColumnNames(decl) }
                ),
              }
            : {}),
          ...(changes.fields.length + rows.fields.length > 0
            ? { fields: [...changes.fields, ...rows.fields] }
            : {}),
          ...(dropped > 0 || changes.lostCells > 0 || rows.removed > 0
            ? {
                destructive: {
                  what: 'cells',
                  counts: {
                    columns: dropped,
                    ...(changes.removedOptions > 0 ? { options: changes.removedOptions } : {}),
                    cells: changes.lostCells,
                    ...(rows.removed > 0 ? { rows: rows.removed } : {}),
                  },
                },
              }
            : {}),
          storedFingerprint: planFingerprint(storedFingerprint(state, bindings), rows.plan),
          ...(action === 'noop' && rows.base
            ? { base: { ...printStoredTable(state, key, bindings).base, rows: rows.base } }
            : {}),
          detail: {
            changes,
            ...(bindings ? { bindings } : {}),
            ...(entryOfStored?.rows ? { baseRows: entryOfStored.rows } : {}),
            ...(rows.plan ? { rows: rows.plan } : {}),
          },
        },
        state,
        decl,
        entryOfStored
      )
    }
  }
}

/**
 * The lock a planned update runs into, as the column writes check them: any column change needs
 * the schema unlocked, and one that rewrites cell data (a drop, a type change, a removed select
 * option) needs the delete lock off too. The table's own name, description and folder are never
 * schema-locked.
 */
function lockFinding(
  key: string,
  state: StoredTableState,
  changes: TableChanges
): WorkspaceSourceDiagnostic | undefined {
  const { locks, name } = state.table
  const rewritesCells =
    changes.removedOptions > 0 ||
    changes.columns.some(
      (column) => column.op === 'drop' || (column.op === 'update' && column.updates.type)
    )
  const lock =
    changes.columns.length > 0 && locks.schemaLocked
      ? 'schema-locked'
      : rewritesCells && locks.deleteLocked
        ? 'delete-locked, and this change rewrites cell data'
        : null
  if (!lock) return undefined
  return kindFinding('table', key, 'E_APPLY_LOCKED', `Table "${name}" is ${lock}.`, {
    hint: 'Unlock it in the table settings, then apply again.',
  })
}

/** The column bindings of `state` for `decl` after a write: each declared column by its name. */
function bindingsAfter(state: StoredTableState, decl: TableDecl): Record<string, BaseColumn> {
  const byName = new Map(state.table.schema.columns.map((column) => [column.name, column]))
  const bindings: Record<string, BaseColumn> = {}
  for (const [columnKey, column] of Object.entries(decl.columns)) {
    const id = byName.get(columnName(columnKey, column))?.id
    if (id) setOwn(bindings, columnKey, { id })
  }
  return bindings
}

/**
 * The stored table, its base entry and reprinted files after a write, keyed by the declaration:
 * managed rows read back as stored (so the base records what the server holds), seed rows as
 * declared. Managed rows past what a directory holds (which a get skips) are not read back: the
 * write has committed, so the rows file reprints as the directory declared it, the base keeps the
 * rows entry it held (`baseRows`), and a finding says why.
 */
async function written(
  ctx: SourceContext,
  key: string,
  tableId: string,
  decl: TableDecl,
  baseRows?: BaseResource['rows']
): Promise<AppliedResource> {
  const state = await reload(ctx, tableId)
  const bindings = bindingsAfter(state, decl)
  const read = await rowsToPrint(ctx, state, bindings, decl).catch((error: unknown) => {
    if (error instanceof StoredRowsOverLimitError) return error
    throw error
  })
  const overLimit = read instanceof StoredRowsOverLimitError
  const { base, printed } = printStoredTable(
    state,
    key,
    bindings,
    overLimit ? { data: decl.rows?.data ?? [] } : read
  )
  if (!overLimit) return { id: tableId, base, text: printed.text }
  return {
    id: tableId,
    base: { ...base, ...(baseRows ? { rows: baseRows } : {}) },
    text: printed.text,
    diagnostics: [
      kindFinding(
        'table',
        key,
        'W_SERVER_CHANGED',
        `${read.message} The apply did not read them back, so ${tableRowsPath(key)} stays as this directory sent it.`,
        { hint: DRIFT_HINT }
      ),
    ],
  }
}

/** The rows a stored table prints with: its managed rows read back, or the declaration's seed. */
async function rowsToPrint(
  ctx: SourceContext,
  state: StoredTableState,
  bindings: Record<string, BaseColumn> | undefined,
  decl?: TableDecl
) {
  const { decl: storedDecl, keyById } = tableAsDecl(state, bindings)
  const rowKey = storedDecl.rows?.key
  if (rowKey !== undefined) {
    return { ...(await readStoredRows(ctx, state.table, keyById, rowKey)), rowKey }
  }
  return decl?.rows?.mode === 'seed' ? { seed: decl.rows } : undefined
}

/**
 * The reshape that carries out a planned update: fields, then drops, column updates, then adds,
 * then the rows and their managed mark. Rows planned at a version are written only while the
 * table still holds that version, checked under the reshape's lock.
 */
function reshapeInput(
  ctx: SourceContext,
  tableId: string,
  plan: TablePlan | undefined
): ReshapeTableInput {
  const workspaceId = ctx.workspace.workspaceId
  const rows = plan?.rows
  const rowsInput = {
    ...(rows?.write ? { rows: rows.write } : {}),
    ...(rows?.mark !== undefined ? { sourceRows: rows.mark } : {}),
    ...(rows?.version !== undefined ? { expectedRowsVersion: rows.version } : {}),
    ...(plan?.keys !== undefined ? { sourceColumnKeys: plan.keys } : {}),
  }
  if (!plan?.changes) return { tableId, workspaceId, ...rowsInput }
  const { table, columns } = plan.changes
  return {
    tableId,
    workspaceId,
    ...(Object.keys(table).length > 0 ? { table } : {}),
    drop: columns.filter(isColumnOp('drop')).map((change) => change.columnId),
    update: columns
      .filter(isColumnOp('update'))
      .map((change) => ({ columnName: change.columnId, updates: change.updates })),
    add: columns.filter(isColumnOp('add')).map((change) => change.column),
    ...rowsInput,
  }
}

/** Tables whose rows version {@link managedRowsMovedSinceBase} reads at once. */
const ROWS_VERSION_CONCURRENCY = 4

/**
 * The undeclared tables an `--allow-delete` plan may delete whose managed rows were written since
 * the base recorded them (their rows version moved), by id.
 */
async function managedRowsMovedSinceBase(
  desired: ReadonlyMap<string, unknown>,
  stored: StoredSet<StoredTableState>,
  ctx: PlanContext
): Promise<Set<string>> {
  if (!ctx.allowDelete) return new Set()
  const recorded = [...stored.bound].flatMap(([key, resource]) => {
    if (desired.has(key)) return []
    const entry = ctx.base?.resources[resourceAddress('table', key)]
    return entry?.id === resource.id && entry.rows
      ? [{ id: resource.id, version: entry.rows.version }]
      : []
  })
  const versions = await mapWithConcurrency(recorded, ROWS_VERSION_CONCURRENCY, ({ id }) =>
    rowsVersion(ctx, id)
  )
  return new Set(
    recorded.filter((table, index) => versions[index] !== table.version).map(({ id }) => id)
  )
}

export const tableAdapter: KindAdapter<'table', StoredTableState> = {
  checkRefs: checkColumnRenamesInUse,
  codec: tableCodec,

  async load(ctx, { allocate }) {
    const { workspaceId } = ctx.workspace
    const [{ tables }, folders] = await Promise.all([
      listTableDefinitionsUseCase.execute({ principal: ctx.principal, input: { workspaceId } }),
      folderIndex(workspaceId),
    ])
    const records = tables.map((table) => ({
      id: table.id,
      name: table.name,
      state: { table, folderPath: tableFolderPathForId(folders, table.folderId) },
    }))
    const set = await bindStored(ctx, 'table', records, { allocate })
    loadedFolders.set(set, new Set(folders.pathById.values()))
    return set
  },

  async plan(desired, stored, ctx) {
    const folders =
      loadedFolders.get(stored) ??
      new Set((await folderIndex(ctx.workspace.workspaceId)).pathById.values())
    const changes: TableChange[] = []
    const declaredNames = new Map<string, string>()
    for (const [key, decl] of desired) {
      const change = await planTable(key, decl, stored, desired, ctx, folders)
      refuseDeclaredTwice(declaredNames, change, decl.name.toLowerCase(), decl.name)
      changes.push(change)
    }
    const rowsMoved = await managedRowsMovedSinceBase(desired, stored, ctx)
    const undeclared = planUndeclared('table', desired, stored, ctx, {
      declared: changes,
      // Its fingerprint leaves out the rows, so a delete of a table whose managed rows moved since
      // the base reads as changed (stale), as an edit of those rows would.
      fingerprint: (resource, entry) =>
        rowsMoved.has(resource.id) ? '' : storedFingerprint(resource.state, entry.columns),
      counts: (resource) => ({ rows: resource.state.table.rowCount }),
      locked: ({ state }) =>
        state.table.locks.deleteLocked
          ? `Table "${state.table.name}" is delete-locked.`
          : undefined,
      detail: (_resource, entry) => (entry.columns ? { bindings: entry.columns } : undefined),
    })
    return [...changes, ...undeclared]
  },

  async authorize(change, ctx) {
    const { principal } = ctx
    const workspaceId = ctx.workspace.workspaceId
    if (change.action === 'create' && change.decl) {
      await createTableUseCase.authorize({
        principal,
        input: { workspaceId, name: change.decl.name, schema: { columns: [] } },
      })
      return
    }
    const tableId = change.storedId
    if (!tableId) return
    if (change.action === 'delete') {
      await deleteTableUseCase.authorize({ principal, input: { tableId, workspaceId } })
      return
    }
    await reshapeTableUseCase.authorize({
      principal,
      input: reshapeInput(ctx, tableId, change.detail),
    })
  },

  async storedFingerprintNow(change, ctx) {
    if (!change.storedId) throw new Error('A table check needs the stored table id')
    const table = storedFingerprint(await reload(ctx, change.storedId), change.detail?.bindings)
    const rows = change.detail?.rows
    return rows?.version === undefined
      ? table
      : planFingerprint(table, { version: await rowsVersion(ctx, change.storedId) })
  },

  async apply(change, ctx) {
    const { principal } = ctx
    const workspaceId = ctx.workspace.workspaceId
    if (change.action === 'delete') {
      if (!change.storedId) throw new Error('A table delete needs the stored table id')
      await deleteTableUseCase.execute({
        principal,
        input: { tableId: change.storedId, workspaceId },
      })
      return { id: change.storedId, text: {} }
    }
    const decl = change.decl
    if (!decl) throw new Error('A table write needs its declaration')
    if (change.action === 'create') {
      const { table } = await createTableUseCase.execute({
        principal,
        input: {
          workspaceId,
          name: decl.name,
          ...(decl.description !== undefined ? { description: decl.description } : {}),
          ...(decl.folder !== undefined ? { folderPath: decl.folder } : {}),
          schema: {
            columns: Object.entries(decl.columns).map(([key, column]) => columnInput(key, column)),
          },
        },
      })
      const rows = change.detail?.rows
      const keys = change.detail?.keys
      const recordsKeys = keys !== undefined && Object.keys(keys).length > 0
      if (rows?.write || rows?.mark || recordsKeys) {
        await reshapeTableUseCase.execute({
          principal,
          input: reshapeInput(ctx, table.id, { rows, ...(recordsKeys ? { keys } : {}) }),
        })
      }
      return written(ctx, change.key, table.id, decl)
    }
    const tableId = change.storedId
    const plan = change.detail
    if (!tableId || !(plan?.changes || plan?.rows || plan?.keys)) {
      throw new Error('A table update needs its plan')
    }
    await reshapeTableUseCase.execute({ principal, input: reshapeInput(ctx, tableId, plan) })
    return written(ctx, change.key, tableId, decl, plan.baseRows)
  },

  async read(stored, ctx) {
    const rows = await rowsToPrint(ctx, stored.state, undefined)
    const { base, printed } = printStoredTable(stored.state, stored.key, undefined, rows)
    const managed = rows && 'rowKey' in rows ? rows : undefined
    const unkeyed = managed ? unkeyedRows(managed, managed.rowKey).length : 0
    return {
      text: printed.text,
      blobs: [],
      base,
      ...(managed && unkeyed > 0
        ? {
            diagnostics: [
              unkeyedFinding(stored.key, stored.state.table.name, managed.rowKey, unkeyed),
            ],
          }
        : {}),
    }
  },
}
