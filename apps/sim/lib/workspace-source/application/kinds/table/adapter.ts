/**
 * Tables as workspace source: `tables/<key>.ts` declares a table's name, description, folder and
 * columns. Every write goes through the table use cases (`createTableUseCase`,
 * `updateTableUseCase`, the column use cases, `deleteTableUseCase`), so their authorization,
 * locks, audit and schema-change signals apply. Rows are never read or written.
 */
import { db } from '@sim/db'
import { generateId } from '@sim/utils/id'
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
import {
  PartiallyAppliedError,
  ResourceChangedError,
} from '@/lib/workspace-source/application/errors'
import {
  noBaseFinding,
  planUndeclared,
  serverChangedFinding,
  staleFinding,
} from '@/lib/workspace-source/application/findings'
import {
  columnInput,
  diffTable,
  type TableChanges,
} from '@/lib/workspace-source/application/kinds/table/diff'
import {
  printStoredTable,
  type StoredTable,
  type StoredTableState,
  tableAsDecl,
} from '@/lib/workspace-source/application/kinds/table/stored'
import { resolveDeclared } from '@/lib/workspace-source/application/three-way'
import type {
  AppliedResource,
  KindAdapter,
  PlanContext,
  PlannedChange,
  SourceContext,
  StoredSet,
} from '@/lib/workspace-source/application/types'
import { claimResourceKey, readKeysByResource, resolveKeys } from '@/lib/workspaces/resource-keys'

/** What the apply carries out for one existing table, decided at plan time. */
interface TablePlan {
  /** The changes an update or adopt makes; absent for a delete. */
  changes?: TableChanges
  /** The table's fingerprint when planned (under `bindings`); the apply refuses if it moved. */
  serverFingerprint: string
  bindings?: Record<string, BaseColumn>
}

type TableChange = PlannedChange<TableDecl, TablePlan>

function storedTable(key: string, state: StoredTableState): StoredTable {
  return { key, id: state.table.id, name: state.table.name, state }
}

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

function finding(key: string, code: string, message: string, hint?: string) {
  return {
    code,
    severity: code.startsWith('E_') ? ('error' as const) : ('warning' as const),
    message,
    ...(hint ? { hint } : {}),
    kind: 'table',
    key,
  }
}

async function planTable(
  key: string,
  decl: TableDecl,
  stored: StoredSet<StoredTableState>,
  ctx: PlanContext,
  folders: ReadonlySet<string>
): Promise<TableChange> {
  const change: TableChange = { kind: 'table', key, action: 'noop', decl, diagnostics: [] }
  if (decl.folder && decl.folder !== '/' && !folders.has(decl.folder)) {
    change.diagnostics.push(
      finding(
        key,
        'E_TABLE_FOLDER',
        `The folder ${decl.folder} does not exist in this workspace.`,
        'Create the folder first, or drop `folder` to keep the table at the root.'
      )
    )
  }
  const resolution = resolveDeclared({
    local: fingerprintOf(tableCodec.canonical(decl)),
    stored: stored.bound.get(key),
    adoptable: stored.unbound.find(
      (candidate) => candidate.name.toLowerCase() === decl.name.toLowerCase()
    ),
    base: ctx.base?.resources[resourceAddress('table', key)],
    fingerprint: (resource, entry) => tableAsDecl(resource.state, entry?.columns).fingerprint,
  })
  switch (resolution.action) {
    case 'stale':
      change.diagnostics.push(staleFinding('table', key))
      return { ...change, storedId: resolution.stored.id }
    case 'no-base':
      change.diagnostics.push(noBaseFinding('table', key))
      return { ...change, storedId: resolution.stored.id }
    case 'noop':
      if (resolution.serverChanged) change.diagnostics.push(serverChangedFinding('table', key))
      return {
        ...change,
        storedId: resolution.stored.id,
        ...(resolution.refreshed ? { base: printStoredTable(resolution.stored, key).base } : {}),
      }
    case 'create': {
      const holder = [...stored.bound.values(), ...stored.unbound].find(
        (table) => table.name.toLowerCase() === decl.name.toLowerCase()
      )
      if (holder) {
        change.diagnostics.push(
          finding(
            key,
            'E_NAME_TAKEN',
            `The table name "${decl.name}" belongs to the table under key "${holder.key}".`,
            'Rename one of them, or declare that table under its own key.'
          )
        )
      }
      ctx.pending.push({ kind: 'table', key, id: generateId() })
      return {
        ...change,
        action: 'create',
        fields: Object.keys(decl.columns).map((column) => `columns.${column} (add)`),
      }
    }
    case 'adopt':
    case 'update': {
      const { state } = resolution.stored
      const bindings = resolution.action === 'update' ? resolution.base.columns : undefined
      const changes = await diffTable(key, decl, state, bindings)
      change.diagnostics.push(...changes.diagnostics)
      const changed = changes.columns.length > 0 || changes.fields.length > 0
      if (changed && state.table.locks.schemaLocked) {
        change.diagnostics.push(
          finding(
            key,
            'E_APPLY_LOCKED',
            `Table "${state.table.name}" is schema-locked.`,
            'Unlock its schema in the table settings, then apply again.'
          )
        )
      }
      if ((changes.dropped > 0 || changes.lostCells > 0) && !ctx.allowDelete) {
        const losses = [
          ...(changes.dropped > 0 ? [`drops ${changes.dropped} column(s)`] : []),
          ...(changes.lostCells > 0 && changes.removedOptions > 0
            ? [`removes ${changes.removedOptions} select option(s)`]
            : []),
        ]
        change.diagnostics.push(
          finding(
            key,
            'E_APPLY_DELETE_NOT_ALLOWED',
            `This ${losses.join(' and ')} of "${state.table.name}", losing ${changes.lostCells} cell(s).`,
            'Pass --allow-delete to apply it, or keep the columns and options declared.'
          )
        )
      }
      return {
        ...change,
        action: resolution.action === 'adopt' ? 'adopt' : changed ? 'update' : 'noop',
        storedId: resolution.stored.id,
        ...(changes.fields.length > 0 ? { fields: changes.fields } : {}),
        ...(changes.lostCells > 0
          ? {
              destructive: {
                what: 'cells',
                counts: {
                  columns: changes.dropped,
                  ...(changes.removedOptions > 0 ? { options: changes.removedOptions } : {}),
                  cells: changes.lostCells,
                },
              },
            }
          : {}),
        detail: {
          changes,
          serverFingerprint: tableAsDecl(state, bindings).fingerprint,
          ...(bindings ? { bindings } : {}),
        },
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
    if (id) bindings[columnKey] = { id }
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
  const { base, printed } = printStoredTable(
    storedTable(key, state),
    key,
    bindingsAfter(state, decl)
  )
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
  plan: TablePlan & { changes: TableChanges },
  decl: TableDecl
): Promise<void> {
  try {
    await applyChanges(ctx, tableId, plan.changes)
  } catch (error) {
    const state = await reload(ctx, tableId).catch(() => null)
    if (!state) throw error
    const bindings = bindingsAfter(state, decl, plan.bindings)
    throw new PartiallyAppliedError(
      error,
      printStoredTable(storedTable(change.key, state), change.key, bindings).base
    )
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
    const ids = tables.map((table) => table.id)
    const keys = allocate
      ? ((
          await resolveKeys(
            workspaceId,
            ids.map((id) => ({ kind: 'table' as const, id })),
            { createdBy: ctx.createdBy }
          )
        ).get('table') ?? new Map<string, string>())
      : await readKeysByResource(db, workspaceId, 'table', ids)
    const set: StoredSet<StoredTableState> = { bound: new Map(), unbound: [] }
    for (const table of tables) {
      const state = { table, folderPath: tableFolderPathForId(folders, table.folderId) }
      const key = keys.get(table.id)
      if (key === undefined) set.unbound.push(storedTable('', state))
      else set.bound.set(key, storedTable(key, state))
    }
    return set
  },

  async plan(desired, stored, ctx) {
    const folders = new Set((await folderIndex(ctx.workspace.workspaceId)).pathById.values())
    const changes: TableChange[] = []
    for (const [key, decl] of desired) {
      changes.push(await planTable(key, decl, stored, ctx, folders))
    }
    const undeclared = planUndeclared<StoredTableState, TableDecl, TablePlan>(
      'table',
      desired,
      stored,
      ctx,
      (resource) => ({
        what: 'table',
        counts: { rows: resource.state.table.rowCount },
      }),
      {
        declared: changes,
        fingerprint: (resource, entry) => tableAsDecl(resource.state, entry.columns).fingerprint,
      }
    )
    for (const change of undeclared) {
      const resource = change.action === 'delete' ? stored.bound.get(change.key) : undefined
      if (!resource) continue
      const bindings = ctx.base?.resources[resourceAddress('table', change.key)]?.columns
      change.detail = {
        serverFingerprint: tableAsDecl(resource.state, bindings).fingerprint,
        ...(bindings ? { bindings } : {}),
      }
    }
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
    const add = columns.find((column) => column.op === 'add')
    const update = columns.find((column) => column.op === 'update')
    const drop = columns.find((column) => column.op === 'drop')
    if (add?.op === 'add') {
      await addTableColumnUseCase.authorize({
        principal,
        input: { tableId, workspaceId, column: add.column },
      })
    }
    if (update?.op === 'update') {
      await updateTableColumnUseCase.authorize({
        principal,
        input: { tableId, workspaceId, columnName: update.columnId, updates: update.updates },
      })
    }
    if (drop?.op === 'drop') {
      await deleteTableColumnUseCase.authorize({
        principal,
        input: { tableId, workspaceId, columnName: drop.columnId },
      })
    }
  },

  async apply(change, ctx) {
    const { principal } = ctx
    const workspaceId = ctx.workspace.workspaceId
    if (change.action === 'delete') {
      if (!change.storedId) throw new Error('A table delete needs the stored table id')
      if (change.detail) {
        const current = await reload(ctx, change.storedId)
        if (
          tableAsDecl(current, change.detail.bindings).fingerprint !==
          change.detail.serverFingerprint
        ) {
          throw new ResourceChangedError(change)
        }
      }
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
      await claimResourceKey({
        workspaceId,
        kind: 'table',
        key: change.key,
        resourceId: table.id,
        origin: 'created',
        createdBy: ctx.createdBy,
      })
      return written(ctx, change.key, table.id, decl)
    }
    const tableId = change.storedId
    const plan = change.detail
    if (!tableId || !plan?.changes) throw new Error('A table update needs its plan')
    const current = await reload(ctx, tableId)
    if (tableAsDecl(current, plan.bindings).fingerprint !== plan.serverFingerprint) {
      throw new ResourceChangedError(change)
    }
    if (change.action === 'adopt') {
      await applyChanges(ctx, tableId, plan.changes)
      await claimResourceKey({
        workspaceId,
        kind: 'table',
        key: change.key,
        resourceId: tableId,
        origin: 'adopted',
        createdBy: ctx.createdBy,
      })
    } else {
      await applyUpdate(ctx, change, tableId, { ...plan, changes: plan.changes }, decl)
    }
    return written(ctx, change.key, tableId, decl)
  },

  async read(stored) {
    const { base, printed } = printStoredTable(stored, stored.key)
    return { text: printed.text, blobs: [], base }
  },
}
