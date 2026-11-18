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
 * a table the apply creates, or adopts while it holds no rows.
 */
import { setOwn } from '@sim/workflow-code'
import {
  type BaseColumn,
  type BaseResource,
  fingerprintOf,
  type ResourceFingerprint,
  resourceAddress,
} from '@sim/workspace-code'
import { columnName, type TableDecl } from '@sim/workspace-code/kinds/table'
import {
  rowKeyText,
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
import { getTableById } from '@/lib/table/service'
import type { RowData, TableSchema } from '@/lib/table/types'
import {
  coerceRowToSchema,
  findBatchUniqueDuplicates,
  validateRowSize,
} from '@/lib/table/validation'
import {
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
import {
  baseRows,
  namedRows,
  readStoredRows,
  rowsVersion,
} from '@/lib/workspace-source/application/kinds/table/rows'
import {
  printStoredTable,
  type StoredTableState,
  storedFingerprint,
  tableAsDecl,
} from '@/lib/workspace-source/application/kinds/table/stored'
import { holdsIn, resolveDeclared, settle } from '@/lib/workspace-source/application/three-way'
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
  /** The managed mark to set, by key column name, or `null` to clear it; absent leaves it. */
  mark?: { mode: 'managed'; keyColumn: string } | null
  /** The row version the plan read the stored rows at; the apply refuses one that moved. */
  version?: number
}

/** What the apply carries out for one table, decided at plan time. */
export interface TablePlan {
  /** The changes an update or adopt makes; absent for a create or delete. */
  changes?: TableChanges
  /** The base's column bindings the plan's fingerprint was read under. */
  bindings?: Record<string, BaseColumn>
  rows?: RowsPlan
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
  diagnostics: WorkspaceSourceDiagnostic[]
}

/** Each declared column's stored name, by column key. */
function namesByKey(decl: TableDecl): Map<string, string> {
  return new Map(
    Object.entries(decl.columns).map(([key, column]) => [key, columnName(key, column)])
  )
}

/** The managed mark a declaration asks for, by its key column's stored name. */
function markOf(decl: TableDecl): { mode: 'managed'; keyColumn: string } | null {
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
  return rows.mode === 'managed' && mark
    ? {
        mode: 'managed',
        keyColumn: mark.keyColumn,
        rows: named,
        columns: [...namesByKey(decl).values()],
        allowDelete,
      }
    : { mode: 'seed', rows: named }
}

/** How many refused rows a finding lists before it counts the rest. */
const LISTED_INVALID_ROWS = 5

/**
 * Refuses declared rows the declared columns cannot hold, checked at plan time as the write checks
 * them, so a dry run fails where the apply would and an apply fails before writing anything: each
 * row within the size limit, coerced to its columns' types and select options without blanking a
 * value (`coerceRowToSchema`, `reject`), with every required cell filled, and no unique value
 * repeated across the rows.
 */
function invalidRowsFinding(
  key: string,
  decl: TableDecl,
  rows: readonly RowData[]
): WorkspaceSourceDiagnostic | undefined {
  const schema: TableSchema = {
    columns: Object.entries(decl.columns).map(([columnKey, column]) =>
      columnInput(columnKey, column)
    ),
  }
  const errorsByRow = new Map<number, string[]>()
  const coerced = rows.map((row, index) => {
    const copy = structuredClone(row)
    const size = validateRowSize(copy)
    const result = size.valid ? coerceRowToSchema(copy, schema, 'reject') : size
    if (!result.valid) errorsByRow.set(index, result.errors)
    return copy
  })
  for (const { row, errors } of findBatchUniqueDuplicates(coerced, schema)) {
    errorsByRow.set(row, [...(errorsByRow.get(row) ?? []), ...errors])
  }
  if (errorsByRow.size === 0) return undefined
  const listed = [...errorsByRow.entries()]
    .sort(([a], [b]) => a - b)
    .slice(0, LISTED_INVALID_ROWS)
    .map(([index, errors]) => `row ${index + 1}: ${errors.join(', ')}`)
  const more = errorsByRow.size - listed.length
  return kindFinding(
    'table',
    key,
    'E_TABLE_ROWS',
    `${errorsByRow.size} row(s) of ${tableRowsPath(key)} do not fit the declared columns: ${listed.join('; ')}${more > 0 ? `; and ${more} more` : ''}.`,
    { file: tableRowsPath(key) }
  )
}

/** The rows `write` writes, refused as {@link invalidRowsFinding} refuses them. */
function writeFindings(
  key: string,
  decl: TableDecl,
  write: ReshapeRows | undefined
): WorkspaceSourceDiagnostic[] {
  const finding = write ? invalidRowsFinding(key, decl, write.rows) : undefined
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
    if (storedKey !== undefined) {
      outcome.plan = { mark: null }
      outcome.fields.push('rows (no longer managed)')
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
  if (based && based.fingerprint === local && marked) return outcome
  const rowKey = rows.key ?? ''
  const stored = await readStoredRows(ctx, state.table, keyById)
  const server = tableRowsFingerprint({ ...rows, data: stored.data })
  if (server === local) {
    if (!marked) outcome.plan = { mark: markOf(decl), version: stored.version }
    else outcome.base = baseRows(rows, stored.version)
    return outcome
  }
  if (based && server !== based.fingerprint) {
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
  const declared = new Set(rows.data.map((row) => rowKeyText(row[rowKey])))
  outcome.removed = stored.data.filter((row) => !declared.has(rowKeyText(row[rowKey]))).length
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
    const bindings = entry?.id === state.table.id ? entry.columns : undefined
    return {
      ...change,
      action: 'update',
      fields: rows.fields,
      ...(rows.removed > 0
        ? { destructive: { what: 'rows', counts: { rows: rows.removed } } }
        : {}),
      serverFingerprint: planFingerprint(storedFingerprint(state, bindings), rows.plan),
      detail: { ...(bindings ? { bindings } : {}), rows: rows.plan },
    }
  }
  if (!rows.base) return change
  const recorded = change.base ?? entry ?? printStoredTable(state, change.key).base
  return { ...change, base: { ...recorded, rows: rows.base } }
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
    if (!resource || settled.action !== 'noop' || !decl.rows) return settled
    return withRows(
      settled,
      await planRows(key, decl, resource.state, entry, ctx),
      resource.state,
      entry
    )
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
        detail: { rows: rows.plan },
      }
    }
    case 'adopt':
    case 'update': {
      const { state } = planned.stored
      const holder = nameHolder(stored, decl.name, { self: planned.stored.id, fold: true })
      if (holder) change.diagnostics.push(nameTakenFinding('table', key, decl.name, holder))
      const bindings = planned.action === 'update' ? planned.base.columns : undefined
      const changes = await diffTable(key, decl, state, bindings)
      change.diagnostics.push(...changes.diagnostics)
      const rows = await planRows(
        key,
        decl,
        state,
        planned.action === 'update' ? planned.base : undefined,
        ctx
      )
      change.diagnostics.push(...rows.diagnostics)
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
      return {
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
        serverFingerprint: planFingerprint(storedFingerprint(state, bindings), rows.plan),
        ...(action === 'noop' && rows.base
          ? { base: { ...printStoredTable(state, key, bindings).base, rows: rows.base } }
          : {}),
        detail: {
          changes,
          ...(bindings ? { bindings } : {}),
          ...(rows.plan ? { rows: rows.plan } : {}),
        },
      }
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
 * declared.
 */
async function written(
  ctx: SourceContext,
  key: string,
  tableId: string,
  decl: TableDecl
): Promise<AppliedResource> {
  const state = await reload(ctx, tableId)
  const bindings = bindingsAfter(state, decl)
  const rows = await rowsToPrint(ctx, state, bindings, decl)
  const { base, printed } = printStoredTable(state, key, bindings, rows)
  return { id: tableId, base, text: printed.text }
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
  if (rowKey !== undefined) return readStoredRows(ctx, state.table, keyById)
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

export const tableAdapter: KindAdapter<'table', StoredTableState> = {
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
    const undeclared = planUndeclared('table', desired, stored, ctx, {
      declared: changes,
      fingerprint: (resource, entry) => storedFingerprint(resource.state, entry.columns),
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

  async fingerprintNow(change, ctx) {
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
      if (rows?.write || rows?.mark) {
        await reshapeTableUseCase.execute({
          principal,
          input: reshapeInput(ctx, table.id, { rows }),
        })
      }
      return written(ctx, change.key, table.id, decl)
    }
    const tableId = change.storedId
    const plan = change.detail
    if (!tableId || !(plan?.changes || plan?.rows)) throw new Error('A table update needs its plan')
    await reshapeTableUseCase.execute({ principal, input: reshapeInput(ctx, tableId, plan) })
    return written(ctx, change.key, tableId, decl)
  },

  async read(stored, ctx) {
    const rows = await rowsToPrint(ctx, stored.state, undefined)
    const { base, printed } = printStoredTable(stored.state, stored.key, undefined, rows)
    return { text: printed.text, blobs: [], base }
  },
}
