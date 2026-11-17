/**
 * Tables as workspace source: `tables/<key>.ts` declares a table's name, description, folder and
 * columns. Every write goes through the table use cases (`createTableUseCase`,
 * `updateTableUseCase`, the column use cases, `deleteTableUseCase`), so their authorization,
 * locks, audit and schema-change signals apply. Rows are never read or written.
 */
import { setOwn } from '@sim/workflow-code'
import { type BaseColumn, fingerprintOf, resourceAddress } from '@sim/workspace-code'
import { columnName, type TableDecl, tableCodec } from '@sim/workspace-code/kinds/table'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { MAX_FOLDERS_PER_WORKSPACE } from '@/lib/folders/constants'
import { loadActiveFolderPathIndex } from '@/lib/folders/queries'
import {
  addTableColumnUseCase,
  deleteTableColumnUseCase,
  updateTableColumnUseCase,
} from '@/lib/table/application/columns'
import { tableFolderPathForId } from '@/lib/table/application/folder-paths'
import {
  createTableUseCase,
  deleteTableUseCase,
  listTableDefinitionsUseCase,
  updateTableUseCase,
} from '@/lib/table/application/tables'
import { getTableById } from '@/lib/table/service'
import { PartiallyAppliedError } from '@/lib/workspace-source/application/errors'
import {
  kindFinding,
  missingFolderFinding,
  nameHolder,
  nameTakenFinding,
  planUndeclared,
  refuseDeclaredTwice,
} from '@/lib/workspace-source/application/findings'
import { bindStored } from '@/lib/workspace-source/application/keys'
import {
  columnInput,
  diffTable,
  isColumnOp,
  type TableChanges,
} from '@/lib/workspace-source/application/kinds/table/diff'
import {
  printStoredTable,
  type StoredTableState,
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
} from '@/lib/workspace-source/application/types'

/** What the apply carries out for one existing table, decided at plan time. */
interface TablePlan {
  /** The changes an update or adopt makes; absent for a delete. */
  changes?: TableChanges
  /** The base's column bindings the plan's fingerprint was read under. */
  bindings?: Record<string, BaseColumn>
}

type TableChange = PlannedChange<TableDecl, TablePlan>

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

async function planTable(
  key: string,
  decl: TableDecl,
  stored: StoredSet<StoredTableState>,
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
    fingerprint: (resource, entry) => tableAsDecl(resource.state, entry?.columns).fingerprint,
    holds: holdsIn(stored),
  })
  const planned = settle(
    resolution,
    change,
    (resource) =>
      printStoredTable(resource.state, key, entry?.id === resource.id ? entry.columns : undefined)
        .base
  )
  if ('settled' in planned) return planned.settled
  switch (planned.action) {
    case 'create': {
      const holder = nameHolder(stored, decl.name, { fold: true })
      if (holder) change.diagnostics.push(nameTakenFinding('table', key, decl.name, holder))
      return {
        ...change,
        action: 'create',
        fields: Object.keys(decl.columns).map((column) => `columns.${column} (add)`),
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
      const changed = changes.columns.length > 0 || changes.fields.length > 0
      if (changed && state.table.locks.schemaLocked) {
        change.diagnostics.push(
          kindFinding(
            'table',
            key,
            'E_APPLY_LOCKED',
            `Table "${state.table.name}" is schema-locked.`,
            { hint: 'Unlock its schema in the table settings, then apply again.' }
          )
        )
      }
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
      return {
        ...change,
        action: planned.action === 'adopt' ? 'adopt' : changed ? 'update' : 'noop',
        storedId: planned.stored.id,
        ...(changes.fields.length > 0 ? { fields: changes.fields } : {}),
        ...(dropped > 0 || changes.lostCells > 0
          ? {
              destructive: {
                what: 'cells',
                counts: {
                  columns: dropped,
                  ...(changes.removedOptions > 0 ? { options: changes.removedOptions } : {}),
                  cells: changes.lostCells,
                },
              },
            }
          : {}),
        serverFingerprint: tableAsDecl(state, bindings).fingerprint,
        detail: { changes, ...(bindings ? { bindings } : {}) },
      }
    }
  }
}

/**
 * The column bindings of `state` for `decl`: the planned ones (by column id, so they survive a
 * rename), and by name for every other declared column the table now holds.
 */
function bindingsAfter(
  state: StoredTableState,
  decl: TableDecl,
  planned: Readonly<Record<string, BaseColumn>> = {}
): Record<string, BaseColumn> {
  const ids = new Set(state.table.schema.columns.map((column) => column.id))
  const byName = new Map(state.table.schema.columns.map((column) => [column.name, column]))
  const bindings: Record<string, BaseColumn> = {}
  for (const [columnKey, column] of Object.entries(decl.columns)) {
    const plannedId = Object.hasOwn(planned, columnKey) ? planned[columnKey].id : undefined
    const id =
      plannedId && ids.has(plannedId) ? plannedId : byName.get(columnName(columnKey, column))?.id
    if (id) setOwn(bindings, columnKey, { id })
  }
  return bindings
}

/** The stored table, its base entry and reprinted file after a write, keyed by the declaration. */
async function written(
  ctx: SourceContext,
  key: string,
  tableId: string,
  decl: TableDecl
): Promise<AppliedResource> {
  const state = await reload(ctx, tableId)
  const { base, printed } = printStoredTable(state, key, bindingsAfter(state, decl))
  return { id: tableId, base, text: printed.text }
}

/**
 * Applies an update's changes; when one fails after others committed, rethrows it with the
 * table's base entry as it now stands, so the next run plans only what is left.
 */
async function applyUpdate(
  ctx: SourceContext,
  change: TableChange,
  tableId: string,
  changes: TableChanges,
  bindings: TablePlan['bindings'],
  decl: TableDecl
): Promise<void> {
  try {
    await applyChanges(ctx, tableId, changes)
  } catch (error) {
    const state = await reload(ctx, tableId).catch(() => null)
    if (!state) throw error
    const after = bindingsAfter(state, decl, bindings)
    throw new PartiallyAppliedError(error, printStoredTable(state, change.key, after).base)
  }
}

/** Carries out a planned table update: fields, then drops, renames and type changes, then adds. */
async function applyChanges(
  ctx: SourceContext,
  tableId: string,
  changes: TableChanges
): Promise<void> {
  const { principal } = ctx
  const workspaceId = ctx.workspace.workspaceId
  const { table, columns } = changes
  if (Object.keys(table).length > 0) {
    const result = await updateTableUseCase.execute({
      principal,
      input: { tableId, workspaceId, ...table },
    })
    if (result.failure) throw result.failure
  }
  for (const change of columns) {
    if (change.op !== 'drop') continue
    await deleteTableColumnUseCase.execute({
      principal,
      input: { tableId, workspaceId, columnName: change.columnId },
    })
  }
  for (const change of columns) {
    if (change.op !== 'update') continue
    await updateTableColumnUseCase.execute({
      principal,
      input: { tableId, workspaceId, columnName: change.columnId, updates: change.updates },
    })
  }
  for (const change of columns) {
    if (change.op !== 'add') continue
    await addTableColumnUseCase.execute({
      principal,
      input: { tableId, workspaceId, column: change.column },
    })
  }
}

export const tableAdapter: KindAdapter<TableDecl, StoredTableState, TablePlan> = {
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
      const change = await planTable(key, decl, stored, ctx, folders)
      refuseDeclaredTwice(declaredNames, change, decl.name.toLowerCase(), decl.name)
      changes.push(change)
    }
    const undeclared = planUndeclared<StoredTableState, TableDecl, TablePlan>(
      'table',
      desired,
      stored,
      ctx,
      {
        declared: changes,
        fingerprint: (resource, entry) => tableAsDecl(resource.state, entry.columns).fingerprint,
        counts: (resource) => ({ rows: resource.state.table.rowCount }),
        detail: (_resource, entry) => (entry.columns ? { bindings: entry.columns } : undefined),
      }
    )
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
    await updateTableUseCase.authorize({ principal, input: { tableId, workspaceId } })
    const columns = change.detail?.changes?.columns ?? []
    const add = columns.find(isColumnOp('add'))
    const update = columns.find(isColumnOp('update'))
    const drop = columns.find(isColumnOp('drop'))
    if (add) {
      await addTableColumnUseCase.authorize({
        principal,
        input: { tableId, workspaceId, column: add.column },
      })
    }
    if (update) {
      await updateTableColumnUseCase.authorize({
        principal,
        input: { tableId, workspaceId, columnName: update.columnId, updates: update.updates },
      })
    }
    if (drop) {
      await deleteTableColumnUseCase.authorize({
        principal,
        input: { tableId, workspaceId, columnName: drop.columnId },
      })
    }
  },

  async fingerprintNow(change, ctx) {
    if (!change.storedId) throw new Error('A table check needs the stored table id')
    return tableAsDecl(await reload(ctx, change.storedId), change.detail?.bindings).fingerprint
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
      return written(ctx, change.key, table.id, decl)
    }
    const tableId = change.storedId
    const plan = change.detail
    if (!tableId || !plan?.changes) throw new Error('A table update needs its plan')
    if (change.action === 'adopt') {
      await applyChanges(ctx, tableId, plan.changes)
      return written(ctx, change.key, tableId, decl)
    }
    await applyUpdate(ctx, change, tableId, plan.changes, plan.bindings, decl)
    return written(ctx, change.key, tableId, decl)
  },

  async read(stored) {
    const { base, printed } = printStoredTable(stored.state, stored.key)
    return { text: printed.text, blobs: [], base }
  },
}
