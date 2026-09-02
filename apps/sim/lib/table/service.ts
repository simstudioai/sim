/**
 * Table service layer for internal programmatic access.
 *
 * Use this for: workflow executor, background jobs, testing business logic.
 * Use API routes for: HTTP requests, frontend clients.
 *
 * Note: API routes have their own implementations for HTTP-specific concerns.
 */

import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { tableJobs, tableViews, userTableDefinitions, userTableRows } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getPostgresErrorCode } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import {
  and,
  asc,
  type Column,
  count,
  eq,
  inArray,
  isNotNull,
  isNull,
  type SQL,
  sql,
} from 'drizzle-orm'
import type { V2TableSortBy } from '@/lib/api/contracts/v2/tables'
import type { ListSortOrder } from '@/lib/api/list-query'
import {
  type CursorKey,
  encodeKeyset,
  INVALID_CURSOR_MESSAGE,
  type KeysetKey,
  keysetAfter,
  keysetColumns,
  listOrderBy,
  searchFilter,
  textKey,
  timestampKey,
} from '@/lib/api/list-query'
import { ForbiddenOperationError } from '@/lib/core/application/forbidden'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { generateRestoreName } from '@/lib/core/utils/restore-name'
import type { DbOrTx } from '@/lib/db/types'
import { resolveRestoredFolderId } from '@/lib/folders/queries'
import { notifyWorkspaceTablesChanged } from '@/lib/realtime/notify'
import { assertRowCapacity, notifyTableRowUsage } from '@/lib/table/billing'
import { generateColumnId, getColumnId, withGeneratedColumnIds } from '@/lib/table/column-keys'
import {
  type ActiveTableReferenceBlocker,
  assertColumnReferencesInWorkspace,
  collectColumnReferencedTableIds,
  findActiveTableReferenceBlockers,
  tableReferenceBlockerMessage,
} from '@/lib/table/column-types/registry.server'
import {
  COLUMN_TYPES,
  DEFAULT_TABLE_VIEW_NAME,
  MAX_TABLE_BATCH_ITEMS,
  NAME_PATTERN,
  TABLE_LIMITS,
} from '@/lib/table/constants'
import { appendTableEvent } from '@/lib/table/events'
import {
  EMPTY_JOB_FIELDS,
  latestJobsForTables,
  latestNonExportJobJson,
  mapJobRow,
} from '@/lib/table/jobs/service'
import { assertSchemaMutable, TableLockedError } from '@/lib/table/mutation-locks'
import { nKeysBetween } from '@/lib/table/order-key'
import type { DbTransaction } from '@/lib/table/planner'
import { assertTableReferenceColumnsEnabled } from '@/lib/table/reference-columns/availability'
import {
  createExactEmptyTableRowSecretProvenance,
  mutateTableRowsWithSecretProvenance,
} from '@/lib/table/rows/secret-provenance'
import { assertValidSchema } from '@/lib/table/schema-invariants'
import { assertTableRowTtlEnabled } from '@/lib/table/ttl-availability'
import { setTableTxTimeouts } from '@/lib/table/tx'
import {
  type CreateTableData,
  type TableDefinition,
  type TableLocks,
  type TableMetadata,
  type TableSchema,
  UNLOCKED_TABLE_LOCKS,
} from '@/lib/table/types'
import { validateTableName, validateTableSchema } from '@/lib/table/validation'
import { stripGroupDeps } from '@/lib/table/workflow-group-deps'

const logger = createLogger('TableService')

/**
 * A table name already taken in the workspace. Kept as its own class because
 * several routes branch on it specifically, and typed as a `conflict` so the
 * generic classifiers reach the same 409 without reading the message.
 */
export class TableConflictError extends OrchestrationError {
  constructor(name: string) {
    super('conflict', `A table named "${name}" already exists in this workspace`)
    this.name = 'TableConflictError'
  }
}

export type TableScope = 'active' | 'archived' | 'all'

/**
 * Lock columns, selected together and read into a {@link TableLocks}. Kept
 * beside `readLocks` so `getTableById`/`listTables` never drift — a missing
 * column would surface `locks` as all-false and silently disable enforcement.
 */
const LOCK_SELECT = {
  schemaLocked: userTableDefinitions.schemaLocked,
  insertLocked: userTableDefinitions.insertLocked,
  updateLocked: userTableDefinitions.updateLocked,
  deleteLocked: userTableDefinitions.deleteLocked,
} as const

function readLocks(row: {
  schemaLocked: boolean
  insertLocked: boolean
  updateLocked: boolean
  deleteLocked: boolean
}): TableLocks {
  return {
    schemaLocked: row.schemaLocked,
    insertLocked: row.insertLocked,
    updateLocked: row.updateLocked,
    deleteLocked: row.deleteLocked,
  }
}

/**
 * Serializes schema/metadata read-modify-writes for a single table so
 * concurrent mutators can't clobber each other's `schema` JSONB
 * (last-writer-wins). Takes a transaction-scoped advisory lock keyed on
 * `tableId`, then re-reads the table INSIDE the lock and hands the fresh
 * definition + transaction to `mutate`. Each serialized writer therefore
 * validates and computes against the prior writer's committed columns.
 *
 * Uses an advisory lock (not `SELECT ... FOR UPDATE` on the definition row) so
 * it adds no edges to the row-lock graph — the row-count trigger (migration
 * 0198) locks the definition row from `insertRow`/`deleteRow`, and a FOR UPDATE
 * here would invert that order. Mirrors `acquireRowOrderLock`. The lock and
 * the read both release at COMMIT/ROLLBACK; the wait is bounded by the
 * `statement_timeout` set in `setTableTxTimeouts`.
 */
export async function withLockedTable<T>(
  tableId: string,
  mutate: (table: TableDefinition, trx: DbTransaction) => Promise<T>,
  opts?: { includeArchived?: boolean; expectedWorkspaceId?: string }
): Promise<T> {
  return db.transaction(async (trx) => {
    await setTableTxTimeouts(trx)
    await trx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`user_table_schema:${tableId}`}, 0))`
    )
    const table = await getTableById(tableId, { tx: trx, includeArchived: opts?.includeArchived })
    if (!table || (opts?.expectedWorkspaceId && table.workspaceId !== opts.expectedWorkspaceId)) {
      throw new OrchestrationError('not_found', 'Table not found')
    }
    return mutate(table, trx)
  })
}

/**
 * Returns `schema` with `columns` sorted by `metadata.columnOrder` (the user-
 * editable visible order). Columns missing from `columnOrder` are appended at
 * the end in their original (schema-creation) order — covers tables created
 * before `columnOrder` existed and any drift from out-of-band column adds.
 *
 * This makes `schema.columns` the single source of truth for column order on
 * the wire. The client doesn't have to join the two arrays itself — every
 * consumer (grid, sidebar, copilot, mothership) gets the same ordered list.
 */
function applyColumnOrderToSchema(
  schema: TableSchema,
  metadata: TableMetadata | null
): TableSchema {
  const order = metadata?.columnOrder
  if (!order || order.length === 0) return schema
  // `columnOrder` holds stable column ids (legacy entries equal the name == id).
  const byId = new Map<string, TableSchema['columns'][number]>()
  for (const c of schema.columns) byId.set(getColumnId(c), c)
  const ordered: TableSchema['columns'] = []
  for (const id of order) {
    const c = byId.get(id)
    if (c) {
      ordered.push(c)
      byId.delete(id)
    }
  }
  for (const c of byId.values()) ordered.push(c)
  return { ...schema, columns: ordered }
}

/**
 * Gets a table by ID with full details.
 *
 * One round trip: the table's latest non-export job comes back in the same SELECT as
 * a correlated lateral ({@link latestNonExportJobJson}) rather than a second query.
 * The two cannot be separated — the reported `rowCount` is the stored count minus the
 * running delete job's `pendingDeleteRemaining`, so dropping the job read would
 * overstate the count mid-delete and let over-capacity inserts through.
 *
 * @param tableId - Table ID to fetch
 * @returns Table definition or null if not found
 */
export async function getTableById(
  tableId: string,
  options?: { includeArchived?: boolean; tx?: DbOrTx }
): Promise<TableDefinition | null> {
  const { includeArchived = false, tx } = options ?? {}
  const executor = tx ?? db
  const results = await executor
    .select({
      id: userTableDefinitions.id,
      name: userTableDefinitions.name,
      description: userTableDefinitions.description,
      schema: userTableDefinitions.schema,
      metadata: userTableDefinitions.metadata,
      maxRows: userTableDefinitions.maxRows,
      workspaceId: userTableDefinitions.workspaceId,
      folderId: userTableDefinitions.folderId,
      createdBy: userTableDefinitions.createdBy,
      archivedAt: userTableDefinitions.archivedAt,
      createdAt: userTableDefinitions.createdAt,
      updatedAt: userTableDefinitions.updatedAt,
      rowCount: userTableDefinitions.rowCount,
      latestJob: latestNonExportJobJson(userTableDefinitions.id),
      ...LOCK_SELECT,
    })
    .from(userTableDefinitions)
    .where(
      includeArchived
        ? eq(userTableDefinitions.id, tableId)
        : and(eq(userTableDefinitions.id, tableId), isNull(userTableDefinitions.archivedAt))
    )
    .limit(1)

  if (results.length === 0) return null

  const table = results[0]
  const metadata = (table.metadata as TableMetadata) ?? null
  const { pendingDeleteRemaining, ...jobFields } = mapJobRow(table.latestJob)
  return {
    id: table.id,
    name: table.name,
    description: table.description,
    schema: applyColumnOrderToSchema(table.schema as TableSchema, metadata),
    metadata,
    rowCount: Math.max(0, table.rowCount - pendingDeleteRemaining),
    maxRows: table.maxRows,
    workspaceId: table.workspaceId,
    folderId: table.folderId,
    createdBy: table.createdBy,
    locks: readLocks(table),
    archivedAt: table.archivedAt,
    createdAt: table.createdAt,
    updatedAt: table.updatedAt,
    ...jobFields,
  }
}

/**
 * Orderings for the public list's sortable fields, made total over the contract
 * enum by `satisfies`. Each ends in `createdAt` so tables sharing a name still
 * come back in a stable order.
 */
const TABLE_SORTS = {
  name: [userTableDefinitions.name, userTableDefinitions.createdAt],
  createdAt: [userTableDefinitions.createdAt],
  updatedAt: [userTableDefinitions.updatedAt, userTableDefinitions.createdAt],
} satisfies Record<V2TableSortBy, readonly Column[]>

/**
 * The keysets behind {@link queryTables}' sortable fields. `satisfies` makes
 * this total over the contract enum, so a new sortable field fails to compile
 * until it has a keyset here rather than silently falling through to an
 * unordered scan.
 *
 * Every key column is `NOT NULL`, and `id` closes each keyset so a page
 * boundary inside a run of equal names or timestamps is still stable.
 */
const tableId = textKey<TableDefinition>(userTableDefinitions.id, (row) => row.id)

/** `TableDefinition` widens its timestamps to `Date | string`; the keyset needs a `Date`. */
const asDate = (value: Date | string): Date => (value instanceof Date ? value : new Date(value))

const TABLE_KEYSETS = {
  name: [textKey<TableDefinition>(userTableDefinitions.name, (row) => row.name), tableId],
  createdAt: [
    timestampKey<TableDefinition>(userTableDefinitions.createdAt, (row) => asDate(row.createdAt)),
    tableId,
  ],
  updatedAt: [
    timestampKey<TableDefinition>(userTableDefinitions.updatedAt, (row) => asDate(row.updatedAt)),
    tableId,
  ],
} satisfies Record<V2TableSortBy, readonly KeysetKey<TableDefinition>[]>

/** The column projection every table listing reads, shared so one row type serves both. */
const TABLE_ROW_SELECT = {
  id: userTableDefinitions.id,
  name: userTableDefinitions.name,
  description: userTableDefinitions.description,
  schema: userTableDefinitions.schema,
  metadata: userTableDefinitions.metadata,
  maxRows: userTableDefinitions.maxRows,
  workspaceId: userTableDefinitions.workspaceId,
  folderId: userTableDefinitions.folderId,
  createdBy: userTableDefinitions.createdBy,
  archivedAt: userTableDefinitions.archivedAt,
  createdAt: userTableDefinitions.createdAt,
  updatedAt: userTableDefinitions.updatedAt,
  rowCount: userTableDefinitions.rowCount,
  ...LOCK_SELECT,
} as const

type TableRowSelection = Awaited<
  ReturnType<ReturnType<typeof db.select<typeof TABLE_ROW_SELECT>>['from']>
>[number]

interface ListTablesOptions {
  scope?: TableScope
  /** Restrict to one table folder. */
  /** `undefined` lists every folder, `null` lists only workspace-root tables. */
  folderId?: string | null
  /** Case-insensitive substring match on the table name. */
  search?: string
  sortBy?: V2TableSortBy
  sortOrder?: ListSortOrder
}

/**
 * Lists all tables in a workspace.
 *
 * Filter and sort are applied in the query — a name search must not become
 * "read every table in the workspace, then discard most of them".
 *
 * @param workspaceId - Workspace ID to list tables for
 * @returns Array of table definitions
 */
export async function listTables(
  workspaceId: string,
  options?: ListTablesOptions
): Promise<TableDefinition[]> {
  const {
    scope = 'active',
    folderId,
    search,
    sortBy = 'createdAt',
    sortOrder = 'asc',
  } = options ?? {}
  const tables = await db
    .select(TABLE_ROW_SELECT)
    .from(userTableDefinitions)
    .where(
      and(
        eq(userTableDefinitions.workspaceId, workspaceId),
        scope === 'all'
          ? undefined
          : scope === 'archived'
            ? isNotNull(userTableDefinitions.archivedAt)
            : isNull(userTableDefinitions.archivedAt),
        folderId === undefined
          ? undefined
          : folderId === null
            ? isNull(userTableDefinitions.folderId)
            : eq(userTableDefinitions.folderId, folderId),
        searchFilter(userTableDefinitions.name, search)
      )
    )
    .orderBy(...listOrderBy(TABLE_SORTS[sortBy], sortOrder))

  return hydrateTableRows(tables)
}

/** Lists active table IDs and names without materializing their schemas. */
export async function listActiveTableNames(
  workspaceId: string,
  tableIds: readonly string[]
): Promise<Array<Pick<TableDefinition, 'id' | 'name'>>> {
  if (tableIds.length === 0) return []

  return db
    .select({ id: userTableDefinitions.id, name: userTableDefinitions.name })
    .from(userTableDefinitions)
    .where(
      and(
        eq(userTableDefinitions.workspaceId, workspaceId),
        inArray(userTableDefinitions.id, [...tableIds]),
        isNull(userTableDefinitions.archivedAt)
      )
    )
}

/** Loads at most two active exact-name matches so callers can fail on corrupt ambiguity. */
export async function findActiveTablesByExactName(
  workspaceId: string,
  name: string
): Promise<TableDefinition[]> {
  const rows = await db
    .select(TABLE_ROW_SELECT)
    .from(userTableDefinitions)
    .where(
      and(
        eq(userTableDefinitions.workspaceId, workspaceId),
        eq(userTableDefinitions.name, name),
        isNull(userTableDefinitions.archivedAt)
      )
    )
    .limit(2)
  return hydrateTableRows(rows)
}

/**
 * Attaches each table's latest job fields and its order-corrected schema. The
 * `rowCount` subtracts rows a pending delete has already claimed, so a table
 * mid-delete reports what a caller can still read rather than the raw column.
 */
async function hydrateTableRows(rows: TableRowSelection[]): Promise<TableDefinition[]> {
  const jobsByTable = await latestJobsForTables(rows.map((t) => t.id))

  return rows.map((t) => {
    const metadata = (t.metadata as TableMetadata) ?? null
    const { pendingDeleteRemaining, ...jobFields } = jobsByTable.get(t.id) ?? EMPTY_JOB_FIELDS
    return {
      id: t.id,
      name: t.name,
      description: t.description,
      schema: applyColumnOrderToSchema(t.schema as TableSchema, metadata),
      metadata,
      rowCount: Math.max(0, t.rowCount - pendingDeleteRemaining),
      maxRows: t.maxRows,
      workspaceId: t.workspaceId,
      folderId: t.folderId,
      createdBy: t.createdBy,
      locks: readLocks(t),
      archivedAt: t.archivedAt,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      ...jobFields,
    }
  })
}

export interface QueryTablesOptions {
  scope?: TableScope
  /** Restrict to one table folder. */
  /** `undefined` lists every folder, `null` lists only workspace-root tables. */
  folderId?: string | null
  /** Case-insensitive substring match on the table name. */
  search?: string
  sortBy: V2TableSortBy
  sortOrder: ListSortOrder
  limit: number
  /** Keyset values from a cursor, in the sort's key order. */
  after?: CursorKey[]
}

export interface QueryTablesResult {
  tables: TableDefinition[]
  /** Keyset values to resume from, or `null` when this page is the last one. */
  nextKeys: CursorKey[] | null
}

/**
 * One filtered, sorted, bounded page of a workspace's tables.
 *
 * Distinct from {@link listTables}, which materializes the whole scope for
 * callers that genuinely need it. Here the filter, the ordering, and the slice
 * are all in the query, so a `search` never costs a full-workspace read — which
 * matters now that tables can be created through the public API in bulk.
 */
export async function queryTables(
  workspaceId: string,
  options: QueryTablesOptions
): Promise<QueryTablesResult> {
  const { scope = 'active', folderId, search, sortBy, sortOrder, limit, after } = options
  const keys = TABLE_KEYSETS[sortBy]

  // A cursor whose values don't bind is a caller error, not an empty filter —
  // coercing it away would silently serve page 1 under a resumed cursor.
  let resumeAfter: SQL | undefined
  if (after) {
    const condition = keysetAfter(keys, after, sortOrder)
    if (!condition) throw new OrchestrationError('validation', INVALID_CURSOR_MESSAGE)
    resumeAfter = condition
  }

  const rows = await db
    .select(TABLE_ROW_SELECT)
    .from(userTableDefinitions)
    .where(
      and(
        eq(userTableDefinitions.workspaceId, workspaceId),
        scope === 'all'
          ? undefined
          : scope === 'archived'
            ? isNotNull(userTableDefinitions.archivedAt)
            : isNull(userTableDefinitions.archivedAt),
        folderId === undefined
          ? undefined
          : folderId === null
            ? isNull(userTableDefinitions.folderId)
            : eq(userTableDefinitions.folderId, folderId),
        searchFilter(userTableDefinitions.name, search),
        resumeAfter
      )
    )
    .orderBy(...listOrderBy(keysetColumns(keys), sortOrder))
    // One extra row is the has-more probe; it never reaches the caller.
    .limit(limit + 1)

  const hasMore = rows.length > limit
  const tables = await hydrateTableRows(rows.slice(0, limit))
  const last = tables.at(-1)

  return { tables, nextKeys: hasMore && last ? encodeKeyset(keys, last) : null }
}

/**
 * The refusal {@link createTable} raises when a workspace is at its table
 * ceiling. Shared so the advisory pre-check answers with the identical code,
 * status, and message as the authoritative one inside the transaction.
 */
function workspaceTableLimitReached(maxTables: number): ForbiddenOperationError {
  /**
   * A quota ceiling, not bad input — both create routes have always answered
   * 403 for it. It names its cause so a client can tell a ceiling apart from a
   * role or key-kind refusal: one is cleared by deleting a table, the other by
   * changing who is calling. The status is left as it shipped, and it disagrees
   * with the row ceiling's 400 — see `TableRowLimitError` in `lib/table/billing`
   * for why both are recorded rather than unified here.
   */
  return new ForbiddenOperationError(
    'WORKSPACE_RESOURCE_LIMIT_REACHED',
    `Workspace has reached maximum table limit (${maxTables})`
  )
}

/**
 * Advisory table-quota check for a caller that is about to make the user pay
 * for work before {@link createTable} would run.
 *
 * The authoritative check is the `FOR NO KEY UPDATE` count inside `createTable`'s
 * transaction and stays there — this one races, by construction, because the
 * ceiling can be reached (or cleared) during whatever the caller does next. It
 * exists so that "next" is not a multi-gigabyte upload: the CSV import used to
 * hand out a presigned PUT for a table it already knew it could not create, and
 * only answered 403 after the whole file had crossed the wire, leaving an
 * orphaned object behind.
 */
export async function assertWorkspaceTableCapacity(
  workspaceId: string,
  maxTables: number
): Promise<void> {
  const [{ count: existingCount }] = await db
    .select({ count: count() })
    .from(userTableDefinitions)
    .where(
      and(
        eq(userTableDefinitions.workspaceId, workspaceId),
        isNull(userTableDefinitions.archivedAt)
      )
    )
  if (Number(existingCount) >= maxTables) throw workspaceTableLimitReached(maxTables)
}

/**
 * Creates a new table.
 *
 * @param data - Table creation data
 * @param requestId - Request ID for logging
 * @returns Created table definition
 * @throws Error if validation fails or limits exceeded
 */
export async function createTable(
  data: CreateTableData,
  requestId: string
): Promise<TableDefinition> {
  // Validate table name
  const nameValidation = validateTableName(data.name)
  if (!nameValidation.valid) {
    throw new OrchestrationError(
      'validation',
      `Invalid table name: ${nameValidation.errors.join(', ')}`
    )
  }

  // Validate schema
  const schemaValidation = validateTableSchema(data.schema)
  if (!schemaValidation.valid) {
    throw new OrchestrationError(
      'validation',
      `Invalid schema: ${schemaValidation.errors.join(', ')}`
    )
  }

  if (data.schema.columns.some((column) => column.type === 'ttl')) {
    await assertTableRowTtlEnabled()
  }
  if (data.schema.columns.some((column) => column.type === 'reference')) {
    await assertTableReferenceColumnsEnabled()
  }

  const tableId = `tbl_${generateId().replace(/-/g, '')}`
  const now = new Date()

  // Stamp stable ids so the table is id-keyed from its first row write.
  const schema = withGeneratedColumnIds(data.schema)

  // The same invariants every later schema mutation enforces, run over what is
  // about to be persisted. `validateTableSchema` above only checks columns in
  // isolation, so a create could store a column naming a workflow group the
  // schema does not declare — which no update path can clear, and which then
  // fails every subsequent add-column and add-group with a 400. Imported lazily
  // because `workflow-columns` transitively reaches the executable tool
  // registry, which a static edge would pull into every page graph that renders
  // a table.
  assertValidSchema(schema, undefined)

  // Row limits are enforced per-write against the current plan (see assertRowCapacity); the stored
  // column is vestigial, so it just takes the caller's value (if any) or the default.
  const maxRows = data.maxRows ?? TABLE_LIMITS.MAX_ROWS_PER_TABLE
  const maxTables = data.maxTables ?? TABLE_LIMITS.MAX_TABLES_PER_WORKSPACE

  const newTable = {
    id: tableId,
    name: data.name,
    description: data.description ?? null,
    schema,
    workspaceId: data.workspaceId,
    folderId: data.folderId ?? null,
    createdBy: data.userId,
    maxRows,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  }

  // Create-mode CSV import is born with a running job so its rows stay hidden until ready.
  const initialJob =
    data.jobStatus === 'running' && data.jobId
      ? { id: data.jobId, type: data.jobType ?? 'import', startedAt: now }
      : null

  // Starter rows count against the plan too. Checked before the tx (the lookup is a
  // separate pool read) — a new table starts empty, so the footprint is just these.
  const initialRowCount = data.initialRowCount ?? 0
  let rowLimit: number | undefined
  if (initialRowCount > 0) {
    rowLimit = await assertRowCapacity({
      workspaceId: data.workspaceId,
      currentRowCount: 0,
      addedRows: initialRowCount,
    })
  }

  // Wrap count check, duplicate check, and insert in a transaction with FOR NO KEY UPDATE
  // to prevent TOCTOU race on the table count limit. The weaker lock still conflicts with
  // itself, so table creations stay serialized, but it does not block unrelated inserts
  // into the workspace's other child tables. See lib/billing/storage/tracking.ts.
  try {
    await db.transaction(async (trx) => {
      await setTableTxTimeouts(trx)
      await trx.execute(
        sql`SELECT 1 FROM workspace WHERE id = ${data.workspaceId} FOR NO KEY UPDATE`
      )
      await assertColumnReferencesInWorkspace(trx, data.workspaceId, schema.columns)

      const [{ count: existingCount }] = await trx
        .select({ count: count() })
        .from(userTableDefinitions)
        .where(
          and(
            eq(userTableDefinitions.workspaceId, data.workspaceId),
            isNull(userTableDefinitions.archivedAt)
          )
        )

      if (Number(existingCount) >= maxTables) throw workspaceTableLimitReached(maxTables)

      const duplicateName = await trx
        .select({ id: userTableDefinitions.id })
        .from(userTableDefinitions)
        .where(
          and(
            eq(userTableDefinitions.workspaceId, data.workspaceId),
            eq(userTableDefinitions.name, data.name),
            isNull(userTableDefinitions.archivedAt)
          )
        )
        .limit(1)

      if (duplicateName.length > 0) {
        throw new TableConflictError(data.name)
      }

      await trx.insert(userTableDefinitions).values(newTable)
      await trx.insert(tableViews).values({
        id: generateId(),
        tableId,
        workspaceId: data.workspaceId,
        name: DEFAULT_TABLE_VIEW_NAME,
        config: {},
        isDefault: true,
        createdBy: data.userId,
        createdAt: now,
        updatedAt: now,
      })

      if (initialJob) {
        await trx.insert(tableJobs).values({
          id: initialJob.id,
          tableId,
          workspaceId: data.workspaceId,
          type: initialJob.type,
          status: 'running',
          payload: data.jobPayload ?? null,
          startedAt: initialJob.startedAt,
          updatedAt: initialJob.startedAt,
        })
      }

      if (initialRowCount > 0) {
        const orderKeys = nKeysBetween(null, null, initialRowCount)
        const rowsToInsert = Array.from({ length: initialRowCount }, (_, i) => ({
          id: `row_${generateId().replace(/-/g, '')}`,
          tableId,
          data: {},
          position: i,
          orderKey: orderKeys[i],
          workspaceId: data.workspaceId,
          createdAt: now,
          updatedAt: now,
        }))
        await mutateTableRowsWithSecretProvenance(trx, {
          rows: rowsToInsert.map((row) => ({
            rowId: row.id,
            provenance: createExactEmptyTableRowSecretProvenance(row.data),
          })),
          rowState: 'new',
          mode: 'replace',
          mutate: async () => {
            const inserted = await trx
              .insert(userTableRows)
              .values(rowsToInsert)
              .returning({ id: userTableRows.id })
            return { value: undefined, affectedRowIds: inserted.map((row) => row.id) }
          },
        })
      }
    })
  } catch (error: unknown) {
    if (error instanceof TableConflictError) {
      throw error
    }
    if (getPostgresErrorCode(error) === '23505') {
      throw new TableConflictError(data.name)
    }
    throw error
  }

  if (initialRowCount > 0 && rowLimit !== undefined) {
    notifyTableRowUsage({
      workspaceId: data.workspaceId,
      currentRowCount: 0,
      addedRows: initialRowCount,
      limit: rowLimit,
    })
  }

  logger.info(`[${requestId}] Created table ${tableId} in workspace ${data.workspaceId}`)

  // Live tables list: tell everyone viewing this workspace's tables to refetch.
  await notifyWorkspaceTablesChanged(data.workspaceId)

  return {
    id: newTable.id,
    name: newTable.name,
    description: newTable.description,
    schema: newTable.schema as TableSchema,
    metadata: null,
    rowCount: data.initialRowCount ?? 0,
    maxRows: newTable.maxRows,
    workspaceId: newTable.workspaceId,
    folderId: newTable.folderId,
    createdBy: newTable.createdBy,
    locks: UNLOCKED_TABLE_LOCKS,
    archivedAt: newTable.archivedAt,
    createdAt: newTable.createdAt,
    updatedAt: newTable.updatedAt,
    jobStatus: initialJob ? 'running' : null,
    jobId: initialJob?.id ?? null,
    jobType: initialJob?.type ?? null,
    jobError: null,
    jobRowsProcessed: 0,
  }
}

/**
 * Adds multiple columns to an existing table inside a caller-provided
 * transaction. This is atomic with respect to the surrounding `trx`: either
 * all columns are added or none are. Validates each column the same way
 * `addTableColumn` does and rejects if any name collides with an existing
 * column or another entry in `columns`.
 *
 * Use this when composing a column addition with other writes (e.g., row
 * inserts) that must succeed or roll back together.
 */
export async function addTableColumnsWithTx(
  trx: DbTransaction,
  table: TableDefinition,
  columns: { id?: string; name: string; type: string; required?: boolean; unique?: boolean }[],
  requestId: string
): Promise<TableDefinition> {
  if (columns.length === 0) return table

  // Runs outside `withLockedTable` (reachable from CSV import with new
  // headers), so it must assert directly.
  assertSchemaMutable(table)

  const usedNames = new Set(table.schema.columns.map((c) => c.name.toLowerCase()))
  const additions: TableSchema['columns'] = []

  for (const column of columns) {
    if (!NAME_PATTERN.test(column.name)) {
      throw new OrchestrationError(
        'validation',
        `Invalid column name "${column.name}". Must start with a letter or underscore and contain only alphanumeric characters and underscores.`
      )
    }
    if (column.name.length > TABLE_LIMITS.MAX_COLUMN_NAME_LENGTH) {
      throw new OrchestrationError(
        'validation',
        `Column name exceeds maximum length (${TABLE_LIMITS.MAX_COLUMN_NAME_LENGTH} characters)`
      )
    }
    if (!COLUMN_TYPES.includes(column.type as (typeof COLUMN_TYPES)[number])) {
      throw new OrchestrationError(
        'validation',
        `Invalid column type "${column.type}". Must be one of: ${COLUMN_TYPES.join(', ')}`
      )
    }
    const lower = column.name.toLowerCase()
    if (usedNames.has(lower)) {
      throw new OrchestrationError('validation', `Column "${column.name}" already exists`)
    }
    usedNames.add(lower)
    // Honor a caller-assigned id (the CSV append path pre-assigns so coercion
    // and persistence agree); otherwise mint one.
    const id = column.id ?? generateColumnId()
    additions.push({
      id,
      name: column.name,
      type: column.type as TableSchema['columns'][number]['type'],
      required: column.required ?? false,
      unique: column.unique ?? false,
    })
  }

  if (table.schema.columns.length + additions.length > TABLE_LIMITS.MAX_COLUMNS_PER_TABLE) {
    throw new OrchestrationError(
      'validation',
      `Adding ${additions.length} column(s) would exceed maximum column limit (${TABLE_LIMITS.MAX_COLUMNS_PER_TABLE})`
    )
  }

  // Spread `table.schema` first so workflow groups (and any future top-level
  // schema fields) survive a CSV import that only adds plain columns.
  const updatedSchema: TableSchema = {
    ...table.schema,
    columns: [...table.schema.columns, ...additions],
  }
  assertValidSchema(updatedSchema, table.metadata?.columnOrder)
  const now = new Date()

  await trx
    .update(userTableDefinitions)
    .set({ schema: updatedSchema, updatedAt: now })
    .where(
      and(
        eq(userTableDefinitions.id, table.id),
        eq(userTableDefinitions.workspaceId, table.workspaceId)
      )
    )

  logger.info(
    `[${requestId}] Added ${additions.length} column(s) to table ${table.id}: ${additions.map((c) => c.name).join(', ')}`
  )

  return {
    ...table,
    schema: updatedSchema,
    updatedAt: now,
  }
}

/**
 * Records the "columns added" audit for a table. The column add shares a
 * transaction with the import's row inserts, so the caller MUST emit this only
 * AFTER that transaction commits — auditing inside the tx would log a false
 * success if a later row batch rolls it back. Skipped when no actor resolves.
 */
export function auditTableColumnsAdded(
  table: TableDefinition,
  columnNames: string[],
  actingUserId?: string
): void {
  const actorId = actingUserId ?? table.createdBy
  if (!actorId || columnNames.length === 0) return
  recordAudit({
    workspaceId: table.workspaceId ?? null,
    actorId,
    action: AuditAction.TABLE_UPDATED,
    resourceType: AuditResourceType.TABLE,
    resourceId: table.id,
    resourceName: table.name,
    description: `Added ${columnNames.length} column(s) to table "${table.name}"`,
    metadata: { op: 'add_columns', columns: columnNames },
  })
}

/**
 * Renames a table.
 *
 * @param tableId - Table ID to rename
 * @param newName - New table name
 * @param requestId - Request ID for logging
 * @returns Updated table definition
 * @throws Error if name is invalid
 */
export async function renameTable(
  tableId: string,
  newName: string,
  requestId: string,
  options?: { expectedWorkspaceId?: string; skipNotify?: boolean }
): Promise<{ id: string; name: string }> {
  const nameValidation = validateTableName(newName)
  if (!nameValidation.valid) {
    throw new OrchestrationError('validation', nameValidation.errors.join(', '))
  }

  const now = new Date()
  try {
    const result = await db
      .update(userTableDefinitions)
      .set({ name: newName, updatedAt: now })
      .where(
        and(
          eq(userTableDefinitions.id, tableId),
          options?.expectedWorkspaceId
            ? eq(userTableDefinitions.workspaceId, options.expectedWorkspaceId)
            : undefined,
          isNull(userTableDefinitions.archivedAt)
        )
      )
      // `workspaceId` is selected for the live-list notify below, not for an audit —
      // the audit moved up to `performRenameTable`.
      .returning({ id: userTableDefinitions.id, workspaceId: userTableDefinitions.workspaceId })

    if (result.length === 0) {
      throw new OrchestrationError('not_found', `Table ${tableId} not found`)
    }

    const { workspaceId } = result[0]

    logger.info(`[${requestId}] Renamed table ${tableId} to "${newName}"`)

    // Live tables list: a rename changes the list result, so everyone viewing refetches.
    if (workspaceId && !options?.skipNotify) await notifyWorkspaceTablesChanged(workspaceId)

    return { id: tableId, name: newName }
  } catch (error: unknown) {
    if (getPostgresErrorCode(error) === '23505') {
      throw new TableConflictError(newName)
    }
    throw error
  }
}

/** Updates a table description without changing its schema or placement. */
export async function updateTableDescription(
  tableId: string,
  workspaceId: string,
  description: string | null,
  requestId: string
): Promise<{ name: string }> {
  const result = await db
    .update(userTableDefinitions)
    .set({ description, updatedAt: new Date() })
    .where(
      and(
        eq(userTableDefinitions.id, tableId),
        eq(userTableDefinitions.workspaceId, workspaceId),
        isNull(userTableDefinitions.archivedAt)
      )
    )
    .returning({ name: userTableDefinitions.name })

  if (result.length === 0) {
    throw new OrchestrationError('not_found', `Table ${tableId} not found`)
  }

  logger.info(`[${requestId}] Updated description for table ${tableId}`)
  await notifyWorkspaceTablesChanged(workspaceId)
  return result[0]
}

/**
 * Moves a table into `folderId`, or to the workspace root when it is `null`.
 *
 * The caller is responsible for verifying that the folder exists, belongs to the same
 * workspace, is active, and carries `resourceType: 'table'` — see `findActiveFolder` in
 * `@/lib/folders/queries`. Table names are unique workspace-wide rather than per folder, so
 * a move can never collide on name.
 *
 * Deliberately asserts no mutation lock: the four `user_table_definitions` lock flags govern
 * schema and row writes, and folder placement is neither.
 */
export async function moveTableToFolder(
  tableId: string,
  workspaceId: string,
  folderId: string | null,
  requestId: string,
  /**
   * `notify: false` for a caller moving several tables in one gesture that
   * sends a single batch notification of its own. Each notify is an internal
   * HTTP round trip with an identical body and triggers an identical
   * workspace-wide invalidation, so a per-item fan-out makes every connected
   * client refetch the same list once per moved table.
   */
  options?: { notify?: boolean }
): Promise<{ name: string }> {
  const updates: Partial<typeof userTableDefinitions.$inferInsert> = {
    folderId,
    updatedAt: new Date(),
  }

  /**
   * Scoped on workspace and active state, not just id: this is exported from `@/lib/table`,
   * so the caller's own authorization is not something the write can assume. An archived
   * table must not be quietly reparented either — it would come back out of Recently Deleted
   * somewhere the user never put it.
   */
  const result = await db
    .update(userTableDefinitions)
    .set(updates)
    .where(
      and(
        eq(userTableDefinitions.id, tableId),
        eq(userTableDefinitions.workspaceId, workspaceId),
        isNull(userTableDefinitions.archivedAt)
      )
    )
    .returning({
      name: userTableDefinitions.name,
      createdBy: userTableDefinitions.createdBy,
    })

  if (result.length === 0) {
    throw new OrchestrationError('not_found', `Table ${tableId} not found`)
  }

  const { name } = result[0]

  logger.info(`[${requestId}] Moved table ${tableId} to folder ${folderId ?? 'root'}`)
  // Live tables list: a move changes each table's folder placement in the list result.
  if (options?.notify ?? true) await notifyWorkspaceTablesChanged(workspaceId)

  return { name }
}

/**
 * Applies a partial lock change to a table. The caller authorizes (admin-only);
 * this function does the write.
 *
 * Writes inside `withLockedTable` so the toggle is serialized against schema
 * mutations on the same table — a lock can't be flipped in the middle of a
 * concurrent column change, closing the check-then-act window on the mutators
 * that assert under that same advisory lock. Deliberately asserts NO lock on
 * itself, so a fully-locked table stays togglable (the reversibility carve-out).
 * Emits a `definition` SSE event so other open viewers refresh their lock state.
 */
export async function updateTableLocks(
  tableId: string,
  partial: Partial<TableLocks>,
  requestId: string
): Promise<{ table: TableDefinition; previousLocks: TableLocks }> {
  let previousLocks: TableLocks = UNLOCKED_TABLE_LOCKS
  const updated = await withLockedTable(tableId, async (table, trx) => {
    previousLocks = table.locks
    const nextLocks: TableLocks = { ...table.locks, ...partial }
    const now = new Date()
    await trx
      .update(userTableDefinitions)
      .set({ ...nextLocks, updatedAt: now })
      .where(eq(userTableDefinitions.id, tableId))
    return { ...table, locks: nextLocks, updatedAt: now }
  })

  await appendTableEvent({ kind: 'definition', tableId, reason: 'locks' }).catch((error) => {
    logger.warn(`[${requestId}] Failed to emit lock-change event for table ${tableId}`, { error })
  })

  logger.info(`[${requestId}] Updated locks for table ${tableId}`)
  return { table: updated, previousLocks }
}

/**
 * Updates a table's metadata (UI state like column widths/order, plus behavioral
 * settings like `workflowColumnBatchSize`). Merges into the existing metadata blob.
 *
 * @param tableId - Table ID to update
 * @param metadata - Partial metadata object (merged with existing)
 * @param existingMetadata - Existing metadata from a prior fetch (avoids redundant DB read)
 * @returns The merged metadata plus whether the reorder also mutated the schema
 */
export async function updateTableMetadata(
  tableId: string,
  metadata: TableMetadata,
  existingMetadata?: TableMetadata | null
): Promise<{ metadata: TableMetadata; schemaChanged: boolean }> {
  const merged: TableMetadata = { ...(existingMetadata ?? {}), ...metadata }

  // When `columnOrder` is in the patch, scrub any workflow-group dependency
  // that now sits to the right of (or at the same index as) its group's
  // leftmost column. Without this, reordering a column could leave a group
  // depending on a column it can no longer reach in the dag — the group
  // would never fire.
  const newOrder = metadata.columnOrder
  let nextSchema: TableSchema | null = null
  if (Array.isArray(newOrder) && newOrder.length > 0) {
    const [tableRow] = await db
      .select({ schema: userTableDefinitions.schema })
      .from(userTableDefinitions)
      .where(eq(userTableDefinitions.id, tableId))
      .limit(1)
    if (tableRow) {
      const schema = tableRow.schema as TableSchema
      const groups = schema.workflowGroups ?? []
      if (groups.length > 0) {
        // `columnOrder` and group dep refs are both keyed by stable column id.
        const positionOf = new Map<string, number>()
        newOrder.forEach((id, i) => positionOf.set(id, i))
        let mutated = false
        const nextGroups = groups.map((group) => {
          const ownCols = schema.columns.filter((c) => c.workflowGroupId === group.id)
          let leftmost = Number.POSITIVE_INFINITY
          for (const c of ownCols) {
            const idx = positionOf.get(getColumnId(c)) ?? Number.POSITIVE_INFINITY
            if (idx < leftmost) leftmost = idx
          }
          if (!Number.isFinite(leftmost)) return group
          const deps = group.dependencies?.columns ?? []
          const removed = new Set(deps.filter((dep) => (positionOf.get(dep) ?? -1) >= leftmost))
          if (removed.size === 0) return group
          const stripped = stripGroupDeps(group, removed)
          if (stripped !== group) mutated = true
          return stripped
        })
        if (mutated) nextSchema = { ...schema, workflowGroups: nextGroups }
      }
    }
  }

  await db
    .update(userTableDefinitions)
    .set(nextSchema ? { metadata: merged, schema: nextSchema } : { metadata: merged })
    .where(eq(userTableDefinitions.id, tableId))

  return { metadata: merged, schemaChanged: nextSchema !== null }
}

/**
 * Archives a table.
 *
 * @param tableId - Table ID to delete
 * @param requestId - Request ID for logging
 * @param actingUserId - User performing the delete, for audit
 * @param options.archivedAt - Shared timestamp for a bulk archive (folder cascade), so the
 * matching restore can identify exactly the set it archived. Defaults to now, leaving
 * single-table callers unaffected. Mirrors `archiveWorkflow`'s option of the same name.
 */
export async function deleteTable(
  tableId: string,
  requestId: string,
  options?: { archivedAt?: Date; skipNotify?: boolean; expectedWorkspaceId?: string }
): Promise<{ archived: { name: string; workspaceId: string | null } | null }> {
  const now = options?.archivedAt ?? new Date()
  const deleted = await db.transaction(async (trx) => {
    await setTableTxTimeouts(trx)
    const [existing] = await trx
      .select({
        name: userTableDefinitions.name,
        archivedAt: userTableDefinitions.archivedAt,
        deleteLocked: userTableDefinitions.deleteLocked,
        workspaceId: userTableDefinitions.workspaceId,
      })
      .from(userTableDefinitions)
      .where(
        and(
          eq(userTableDefinitions.id, tableId),
          options?.expectedWorkspaceId
            ? eq(userTableDefinitions.workspaceId, options.expectedWorkspaceId)
            : undefined
        )
      )
      .for('update')
      .limit(1)

    if (!existing || existing.archivedAt) return null
    if (existing.deleteLocked) {
      logger.warn('Table mutation blocked by lock', {
        tableId,
        workspaceId: existing.workspaceId,
        lock: 'delete',
      })
      throw new TableLockedError('delete')
    }

    const blockers = existing.workspaceId
      ? await findActiveTableReferenceBlockers(trx, existing.workspaceId, {
          tableIds: [tableId],
        })
      : []
    if (blockers.length > 0) {
      throw new OrchestrationError(
        'conflict',
        tableReferenceBlockerMessage(
          existing.name,
          blockers.map((blocker) => blocker.referencingTableName)
        )
      )
    }

    const [archived] = await trx
      .update(userTableDefinitions)
      .set({ archivedAt: now, updatedAt: now })
      .where(
        and(
          eq(userTableDefinitions.id, tableId),
          isNull(userTableDefinitions.archivedAt),
          eq(userTableDefinitions.deleteLocked, false)
        )
      )
      .returning({
        workspaceId: userTableDefinitions.workspaceId,
        name: userTableDefinitions.name,
      })
    return archived ?? null
  })

  logger.info(`[${requestId}] Archived table ${tableId}`)
  // Live tables list: only on a genuine archive (a no-op/already-archived delete changes nothing).
  // Skipped under a folder cascade — deleteFolder fires one folder-level notify for the whole subtree,
  // so we don't spam one relay call per archived table.
  if (deleted?.workspaceId && !options?.skipNotify)
    await notifyWorkspaceTablesChanged(deleted.workspaceId)

  // Null when the table was missing or already archived — a silent no-op. The
  // caller audits only a genuine archive, so a repeat delete logs nothing.
  return { archived: deleted ? { name: deleted.name, workspaceId: deleted.workspaceId } : null }
}

export interface DeleteTablesResult {
  archived: { id: string; name: string; workspaceId: string }[]
  failed: { id: string; name: string; reason: string }[]
  notFound: string[]
  terminalError?: unknown
}

interface ReferenceSafeArchivePlan<T> {
  ordered: T[]
  blockedByCycle: T[]
}

/**
 * Orders selected tables so every referrer is archived before its target.
 *
 * Self-references are safe because the one row changes state atomically. Any
 * rows left after the topological walk belong to a multi-table cycle or are
 * targets reachable from one; none can be archived while a cycle member stays
 * active.
 */
function planReferenceSafeArchiveOrder<T extends { id: string; schema: unknown }>(
  candidates: readonly T[],
  externallyBlockedIds: ReadonlySet<string>
): ReferenceSafeArchivePlan<T> {
  const deletable = candidates.filter((table) => !externallyBlockedIds.has(table.id))
  const deletableById = new Map(deletable.map((table) => [table.id, table]))
  const targetsByReferrer = new Map<string, string[]>()
  const inboundReferenceCount = new Map(deletable.map((table) => [table.id, 0]))

  for (const table of deletable) {
    const targets = collectColumnReferencedTableIds((table.schema as TableSchema).columns).filter(
      (targetId) => targetId !== table.id && deletableById.has(targetId)
    )
    targetsByReferrer.set(table.id, targets)
    for (const targetId of targets) {
      inboundReferenceCount.set(targetId, (inboundReferenceCount.get(targetId) ?? 0) + 1)
    }
  }

  const ready = deletable.filter((table) => inboundReferenceCount.get(table.id) === 0)
  const ordered: T[] = []
  const orderedIds = new Set<string>()
  for (let index = 0; index < ready.length; index++) {
    const table = ready[index]
    ordered.push(table)
    orderedIds.add(table.id)
    for (const targetId of targetsByReferrer.get(table.id) ?? []) {
      const remaining = (inboundReferenceCount.get(targetId) ?? 0) - 1
      inboundReferenceCount.set(targetId, remaining)
      if (remaining === 0) {
        const target = deletableById.get(targetId)
        if (target) ready.push(target)
      }
    }
  }

  return {
    ordered,
    blockedByCycle: deletable.filter((table) => !orderedIds.has(table.id)),
  }
}

function tableReferenceCycleMessage(tableName: string): string {
  return `Cannot delete table "${tableName}" because the selected tables contain a reference cycle that cannot be restored safely. Remove a reference column first.`
}

/**
 * Archives a bounded table selection after one reference-graph scan.
 *
 * All explicit targets are locked before the scan. Reference-column writes take a conflicting
 * key-share lock on their target, so the scan and every archive in this transaction observe one
 * stable reference graph. Per-table savepoints preserve the bulk API's committed-prefix behavior
 * for statement failures that can roll back to a savepoint. A connection loss or other failure
 * that invalidates the outer transaction rolls back the entire table phase.
 */
export async function deleteTables(
  tableIds: readonly string[],
  requestId: string,
  options: {
    expectedWorkspaceId: string
    archivedAt?: Date
    skipNotify?: boolean
  }
): Promise<DeleteTablesResult> {
  const requestedIds = [...new Set(tableIds)]
  if (requestedIds.length > MAX_TABLE_BATCH_ITEMS) {
    throw new OrchestrationError(
      'validation',
      `Cannot delete more than ${MAX_TABLE_BATCH_ITEMS} tables at once`
    )
  }
  if (requestedIds.length === 0) {
    return { archived: [], failed: [], notFound: [] }
  }
  const now = options.archivedAt ?? new Date()
  const result = await db.transaction(async (trx): Promise<DeleteTablesResult> => {
    await setTableTxTimeouts(trx)
    const advisoryLockIds = [...requestedIds].sort()
    await trx.execute(sql`
      SELECT pg_advisory_xact_lock(hashtextextended('user_table_schema:' || requested_id, 0))
      FROM unnest(${advisoryLockIds}::text[]) AS requested(requested_id)
      ORDER BY requested_id
    `)
    const existing = await trx
      .select({
        id: userTableDefinitions.id,
        name: userTableDefinitions.name,
        schema: userTableDefinitions.schema,
        archivedAt: userTableDefinitions.archivedAt,
        deleteLocked: userTableDefinitions.deleteLocked,
        workspaceId: userTableDefinitions.workspaceId,
      })
      .from(userTableDefinitions)
      .where(
        and(
          eq(userTableDefinitions.workspaceId, options.expectedWorkspaceId),
          inArray(userTableDefinitions.id, requestedIds)
        )
      )
      .orderBy(asc(userTableDefinitions.id))
      .for('update')

    const existingById = new Map(existing.map((table) => [table.id, table]))
    const notFound: string[] = []
    const failed: DeleteTablesResult['failed'] = []
    const candidates: typeof existing = []
    for (const tableId of requestedIds) {
      const table = existingById.get(tableId)
      if (!table || table.archivedAt) {
        notFound.push(tableId)
        continue
      }
      if (table.deleteLocked) {
        failed.push({
          id: table.id,
          name: table.name,
          reason: new TableLockedError('delete').message,
        })
        continue
      }
      candidates.push(table)
    }

    const referenceBlockers = await findActiveTableReferenceBlockers(
      trx,
      options.expectedWorkspaceId,
      {
        tableIds: candidates.map((table) => table.id),
      }
    )
    const blockersByTargetId = new Map<string, ActiveTableReferenceBlocker[]>()
    for (const blocker of referenceBlockers) {
      const targetBlockers = blockersByTargetId.get(blocker.targetTableId) ?? []
      targetBlockers.push(blocker)
      blockersByTargetId.set(blocker.targetTableId, targetBlockers)
    }

    const externallyBlockedIds = new Set(blockersByTargetId.keys())
    const archivePlan = planReferenceSafeArchiveOrder(candidates, externallyBlockedIds)
    const cycleBlockedIds = new Set(archivePlan.blockedByCycle.map((table) => table.id))
    for (const table of candidates) {
      const blockers = blockersByTargetId.get(table.id)
      if (blockers && blockers.length > 0) {
        failed.push({
          id: table.id,
          name: table.name,
          reason: tableReferenceBlockerMessage(
            table.name,
            blockers.map((blocker) => blocker.referencingTableName)
          ),
        })
        continue
      }
      if (cycleBlockedIds.has(table.id)) {
        failed.push({
          id: table.id,
          name: table.name,
          reason: tableReferenceCycleMessage(table.name),
        })
      }
    }

    const archived: DeleteTablesResult['archived'] = []
    let terminalError: unknown
    for (const table of archivePlan.ordered) {
      try {
        const [updated] = await trx.transaction((savepoint) =>
          savepoint
            .update(userTableDefinitions)
            .set({ archivedAt: now, updatedAt: now })
            .where(
              and(
                eq(userTableDefinitions.id, table.id),
                eq(userTableDefinitions.workspaceId, options.expectedWorkspaceId),
                isNull(userTableDefinitions.archivedAt),
                eq(userTableDefinitions.deleteLocked, false)
              )
            )
            .returning({
              id: userTableDefinitions.id,
              workspaceId: userTableDefinitions.workspaceId,
              name: userTableDefinitions.name,
            })
        )
        if (!updated) {
          notFound.push(table.id)
          terminalError = new OrchestrationError(
            'internal',
            `Table "${table.id}" could not be archived after its deletion lock was acquired`
          )
          break
        }
        archived.push(updated)
      } catch (error) {
        terminalError = error
        break
      }
    }

    return {
      archived,
      failed,
      notFound,
      ...(terminalError !== undefined ? { terminalError } : {}),
    }
  })

  logger.info(`[${requestId}] Archived ${result.archived.length} tables in batch`)
  if (result.archived.length > 0 && !options.skipNotify) {
    await notifyWorkspaceTablesChanged(options.expectedWorkspaceId)
  }
  return result
}

/**
 * Restores an archived table.
 *
 * Deliberately NOT gated by any lock. Restore is additive — it clears the
 * archive tombstone and renames to dodge the unique index; it destroys nothing.
 * Gating it on the delete lock would strand a delete-locked table that was
 * archived by a bypass path (e.g. workspace archive, which has no un-archive),
 * making the lock the thing that permanently loses the data it protects.
 */
export async function restoreTable(
  tableId: string,
  requestId: string,
  options?: {
    restoringFolderIds?: ReadonlySet<string>
    restoringTableIds?: ReadonlySet<string>
    skipNotify?: boolean
  }
): Promise<void> {
  const table = await getTableById(tableId, { includeArchived: true })
  if (!table) {
    throw new OrchestrationError('not_found', 'Table not found')
  }

  if (!table.archivedAt) {
    throw new OrchestrationError('validation', 'Table is not archived')
  }

  if (table.workspaceId) {
    const { getWorkspaceWithOwner } = await import('@/lib/workspaces/permissions/utils')
    const ws = await getWorkspaceWithOwner(table.workspaceId)
    if (!ws || ws.archivedAt) {
      throw new OrchestrationError('validation', 'Cannot restore table into an archived workspace')
    }
  }

  /**
   * Restoring a table whose folder is still archived would file it under a folder the Tables
   * page never renders, leaving an active row nobody can reach. Re-root it instead — the same
   * treatment `restoreFolder` gives a folder with an archived parent. `restoringFolderIds`
   * exempts the folder subtree this restore is part of, which is still archived at the moment
   * the cascade calls in.
   */
  const restoredFolderId = await resolveRestoredFolderId(
    table.folderId,
    table.workspaceId,
    'table',
    options?.restoringFolderIds
  )

  /**
   * A concurrent rename/create can claim the chosen name after `generateRestoreName`'s check (MVCC).
   * Retries pick a new random suffix; 23505 maps to {@link TableConflictError} after exhaustion.
   */
  const maxUniqueViolationRetries = 8
  let attemptedRestoreName = ''

  for (let attempt = 0; attempt < maxUniqueViolationRetries; attempt++) {
    attemptedRestoreName = ''
    try {
      await db.transaction(async (tx) => {
        await setTableTxTimeouts(tx)
        const [currentTable] = await tx
          .select({
            workspaceId: userTableDefinitions.workspaceId,
            schema: userTableDefinitions.schema,
          })
          .from(userTableDefinitions)
          .where(eq(userTableDefinitions.id, tableId))
          .for('update')
          .limit(1)
        if (!currentTable) throw new OrchestrationError('not_found', 'Table not found')

        const allowedArchivedTableIds = new Set(options?.restoringTableIds)
        allowedArchivedTableIds.add(tableId)
        await assertColumnReferencesInWorkspace(
          tx,
          currentTable.workspaceId,
          (currentTable.schema as TableSchema).columns,
          { allowedArchivedTableIds }
        )

        attemptedRestoreName = await generateRestoreName(table.name, async (candidate) => {
          const [match] = await tx
            .select({ id: userTableDefinitions.id })
            .from(userTableDefinitions)
            .where(
              and(
                eq(userTableDefinitions.workspaceId, table.workspaceId),
                eq(userTableDefinitions.name, candidate),
                isNull(userTableDefinitions.archivedAt)
              )
            )
            .limit(1)
          return !!match
        })

        const now = new Date()
        await tx
          .update(userTableDefinitions)
          .set({
            archivedAt: null,
            updatedAt: now,
            name: attemptedRestoreName,
            folderId: restoredFolderId,
          })
          .where(eq(userTableDefinitions.id, tableId))
      })
      break
    } catch (error: unknown) {
      if (getPostgresErrorCode(error) !== '23505') {
        throw error
      }
      if (attempt === maxUniqueViolationRetries - 1) {
        throw new TableConflictError(attemptedRestoreName || table.name)
      }
    }
  }

  logger.info(`[${requestId}] Restored table ${tableId} as "${attemptedRestoreName}"`)

  // Live tables list: a restore re-adds the table to the active list. Skipped under a folder cascade —
  // restoreFolder fires one folder-level notify for the whole subtree (see deleteTable).
  if (table.workspaceId && !options?.skipNotify)
    await notifyWorkspaceTablesChanged(table.workspaceId)
}
