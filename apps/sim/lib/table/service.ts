/**
 * Table service layer for internal programmatic access.
 *
 * Use this for: workflow executor, background jobs, testing business logic.
 * Use API routes for: HTTP requests, frontend clients.
 *
 * Note: API routes have their own implementations for HTTP-specific concerns.
 */

import { db } from '@sim/db'
import { tableJobs, userTableDefinitions, userTableRows } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getPostgresErrorCode } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, count, eq, isNull, sql } from 'drizzle-orm'
import { generateRestoreName } from '@/lib/core/utils/restore-name'
import type { DbOrTx } from '@/lib/db/types'
import {
  columnMatchesRef,
  generateColumnId,
  getColumnId,
  remapGroupColumnRefs,
  withGeneratedColumnIds,
} from './column-keys'
import { COLUMN_TYPES, NAME_PATTERN, TABLE_LIMITS } from './constants'
import { CSV_MAX_BATCH_SIZE } from './import'
import { EMPTY_JOB_FIELDS, latestJobForTable, latestJobsForTables } from './jobs/service'
import { nKeysBetween } from './order-key'
import type { DbTransaction } from './planner'
import { stripGroupExecutions } from './rows/executions'
import { acquireRowOrderLock } from './rows/ordering'
import { batchInsertRowsWithTx, replaceTableRowsWithTx } from './rows/service'
import { setTableTxTimeouts } from './tx'
import type {
  AddWorkflowGroupData,
  ColumnDefinition,
  CreateTableData,
  DeleteWorkflowGroupData,
  ReplaceRowsResult,
  RowData,
  TableDefinition,
  TableMetadata,
  TableRow,
  TableSchema,
  UpdateWorkflowGroupData,
  WorkflowGroup,
  WorkflowGroupOutput,
} from './types'
import {
  checkBatchUniqueConstraintsDb,
  coerceRowToSchema,
  getUniqueColumns,
  validateRowSize,
  validateTableName,
  validateTableSchema,
} from './validation'
import { assertValidSchema, runWorkflowColumn, stripGroupDeps } from './workflow-columns'

const logger = createLogger('TableService')

export class TableConflictError extends Error {
  readonly code = 'TABLE_EXISTS' as const
  constructor(name: string) {
    super(`A table named "${name}" already exists in this workspace`)
  }
}

export type TableScope = 'active' | 'archived' | 'all'

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
 * here would invert that order. Mirrors `acquireTablePositionLock`. The lock and
 * the read both release at COMMIT/ROLLBACK; the wait is bounded by the
 * `statement_timeout` set in `setTableTxTimeouts`.
 */
export async function withLockedTable<T>(
  tableId: string,
  mutate: (table: TableDefinition, trx: DbTransaction) => Promise<T>,
  opts?: { includeArchived?: boolean }
): Promise<T> {
  return db.transaction(async (trx) => {
    await setTableTxTimeouts(trx)
    await trx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`user_table_schema:${tableId}`}, 0))`
    )
    const table = await getTableById(tableId, { tx: trx, includeArchived: opts?.includeArchived })
    if (!table) {
      throw new Error('Table not found')
    }
    return mutate(table, trx)
  })
}

/**
 * Gets a table by ID with full details.
 *
 * @param tableId - Table ID to fetch
 * @returns Table definition or null if not found
 */
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
      createdBy: userTableDefinitions.createdBy,
      archivedAt: userTableDefinitions.archivedAt,
      createdAt: userTableDefinitions.createdAt,
      updatedAt: userTableDefinitions.updatedAt,
      rowCount: userTableDefinitions.rowCount,
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
  const { pendingDeleteRemaining, ...jobFields } = await latestJobForTable(tableId, executor)
  return {
    id: table.id,
    name: table.name,
    description: table.description,
    schema: applyColumnOrderToSchema(table.schema as TableSchema, metadata),
    metadata,
    rowCount: Math.max(0, table.rowCount - pendingDeleteRemaining),
    maxRows: table.maxRows,
    workspaceId: table.workspaceId,
    createdBy: table.createdBy,
    archivedAt: table.archivedAt,
    createdAt: table.createdAt,
    updatedAt: table.updatedAt,
    ...jobFields,
  }
}

/**
 * Lists all tables in a workspace.
 *
 * @param workspaceId - Workspace ID to list tables for
 * @returns Array of table definitions
 */
async function countTables(workspaceId: string): Promise<number> {
  const [result] = await db
    .select({ count: count() })
    .from(userTableDefinitions)
    .where(
      and(
        eq(userTableDefinitions.workspaceId, workspaceId),
        isNull(userTableDefinitions.archivedAt)
      )
    )
  return result.count
}

export async function listTables(
  workspaceId: string,
  options?: { scope?: TableScope }
): Promise<TableDefinition[]> {
  const { scope = 'active' } = options ?? {}
  const tables = await db
    .select({
      id: userTableDefinitions.id,
      name: userTableDefinitions.name,
      description: userTableDefinitions.description,
      schema: userTableDefinitions.schema,
      metadata: userTableDefinitions.metadata,
      maxRows: userTableDefinitions.maxRows,
      workspaceId: userTableDefinitions.workspaceId,
      createdBy: userTableDefinitions.createdBy,
      archivedAt: userTableDefinitions.archivedAt,
      createdAt: userTableDefinitions.createdAt,
      updatedAt: userTableDefinitions.updatedAt,
      rowCount: userTableDefinitions.rowCount,
    })
    .from(userTableDefinitions)
    .where(
      scope === 'all'
        ? eq(userTableDefinitions.workspaceId, workspaceId)
        : scope === 'archived'
          ? and(
              eq(userTableDefinitions.workspaceId, workspaceId),
              sql`${userTableDefinitions.archivedAt} IS NOT NULL`
            )
          : and(
              eq(userTableDefinitions.workspaceId, workspaceId),
              isNull(userTableDefinitions.archivedAt)
            )
    )
    .orderBy(userTableDefinitions.createdAt)

  const jobsByTable = await latestJobsForTables(tables.map((t) => t.id))

  return tables.map((t) => {
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
      createdBy: t.createdBy,
      archivedAt: t.archivedAt,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      ...jobFields,
    }
  })
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
    throw new Error(`Invalid table name: ${nameValidation.errors.join(', ')}`)
  }

  // Validate schema
  const schemaValidation = validateTableSchema(data.schema)
  if (!schemaValidation.valid) {
    throw new Error(`Invalid schema: ${schemaValidation.errors.join(', ')}`)
  }

  const tableId = `tbl_${generateId().replace(/-/g, '')}`
  const now = new Date()

  // Stamp stable ids so the table is id-keyed from its first row write.
  const schema = withGeneratedColumnIds(data.schema)

  // Use provided maxRows (from billing plan) or fall back to default
  const maxRows = data.maxRows ?? TABLE_LIMITS.MAX_ROWS_PER_TABLE
  const maxTables = data.maxTables ?? TABLE_LIMITS.MAX_TABLES_PER_WORKSPACE

  const newTable = {
    id: tableId,
    name: data.name,
    description: data.description ?? null,
    schema,
    workspaceId: data.workspaceId,
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

  // Wrap count check, duplicate check, and insert in a transaction with FOR UPDATE
  // to prevent TOCTOU race on the table count limit
  try {
    await db.transaction(async (trx) => {
      await setTableTxTimeouts(trx)
      await trx.execute(sql`SELECT 1 FROM workspace WHERE id = ${data.workspaceId} FOR UPDATE`)

      const [{ count: existingCount }] = await trx
        .select({ count: count() })
        .from(userTableDefinitions)
        .where(
          and(
            eq(userTableDefinitions.workspaceId, data.workspaceId),
            isNull(userTableDefinitions.archivedAt)
          )
        )

      if (Number(existingCount) >= maxTables) {
        throw new Error(`Workspace has reached maximum table limit (${maxTables})`)
      }

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

      if (initialJob) {
        await trx.insert(tableJobs).values({
          id: initialJob.id,
          tableId,
          workspaceId: data.workspaceId,
          type: initialJob.type,
          status: 'running',
          startedAt: initialJob.startedAt,
          updatedAt: initialJob.startedAt,
        })
      }

      const initialRowCount = data.initialRowCount ?? 0
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
        await trx.insert(userTableRows).values(rowsToInsert)
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

  logger.info(`[${requestId}] Created table ${tableId} in workspace ${data.workspaceId}`)

  return {
    id: newTable.id,
    name: newTable.name,
    description: newTable.description,
    schema: newTable.schema as TableSchema,
    metadata: null,
    rowCount: data.initialRowCount ?? 0,
    maxRows: newTable.maxRows,
    workspaceId: newTable.workspaceId,
    createdBy: newTable.createdBy,
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

  const usedNames = new Set(table.schema.columns.map((c) => c.name.toLowerCase()))
  const additions: TableSchema['columns'] = []

  for (const column of columns) {
    if (!NAME_PATTERN.test(column.name)) {
      throw new Error(
        `Invalid column name "${column.name}". Must start with a letter or underscore and contain only alphanumeric characters and underscores.`
      )
    }
    if (column.name.length > TABLE_LIMITS.MAX_COLUMN_NAME_LENGTH) {
      throw new Error(
        `Column name exceeds maximum length (${TABLE_LIMITS.MAX_COLUMN_NAME_LENGTH} characters)`
      )
    }
    if (!COLUMN_TYPES.includes(column.type as (typeof COLUMN_TYPES)[number])) {
      throw new Error(
        `Invalid column type "${column.type}". Must be one of: ${COLUMN_TYPES.join(', ')}`
      )
    }
    const lower = column.name.toLowerCase()
    if (usedNames.has(lower)) {
      throw new Error(`Column "${column.name}" already exists`)
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
    throw new Error(
      `Adding ${additions.length} column(s) would exceed maximum column limit (${TABLE_LIMITS.MAX_COLUMNS_PER_TABLE})`
    )
  }

  // Spread `table.schema` first so workflow groups (and any future top-level
  // schema fields) survive a CSV import that only adds plain columns.
  const updatedSchema: TableSchema = {
    ...table.schema,
    columns: [...table.schema.columns, ...additions],
  }
  const now = new Date()

  await trx
    .update(userTableDefinitions)
    .set({ schema: updatedSchema, updatedAt: now })
    .where(eq(userTableDefinitions.id, table.id))

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
  requestId: string
): Promise<{ id: string; name: string }> {
  const nameValidation = validateTableName(newName)
  if (!nameValidation.valid) {
    throw new Error(nameValidation.errors.join(', '))
  }

  const now = new Date()
  try {
    const result = await db
      .update(userTableDefinitions)
      .set({ name: newName, updatedAt: now })
      .where(eq(userTableDefinitions.id, tableId))
      .returning({ id: userTableDefinitions.id })

    if (result.length === 0) {
      throw new Error(`Table ${tableId} not found`)
    }

    logger.info(`[${requestId}] Renamed table ${tableId} to "${newName}"`)
    return { id: tableId, name: newName }
  } catch (error: unknown) {
    if (getPostgresErrorCode(error) === '23505') {
      throw new TableConflictError(newName)
    }
    throw error
  }
}

/**
 * Updates a table's metadata (UI state like column widths/order, plus behavioral
 * settings like `workflowColumnBatchSize`). Merges into the existing metadata blob.
 *
 * @param tableId - Table ID to update
 * @param metadata - Partial metadata object (merged with existing)
 * @param existingMetadata - Existing metadata from a prior fetch (avoids redundant DB read)
 * @returns Updated metadata
 */
export async function updateTableMetadata(
  tableId: string,
  metadata: TableMetadata,
  existingMetadata?: TableMetadata | null
): Promise<TableMetadata> {
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

  return merged
}

/**
 * Archives a table.
 *
 * @param tableId - Table ID to delete
 * @param requestId - Request ID for logging
 */
export async function deleteTable(tableId: string, requestId: string): Promise<void> {
  await db
    .update(userTableDefinitions)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(eq(userTableDefinitions.id, tableId))

  logger.info(`[${requestId}] Archived table ${tableId}`)
}

/**
 * Drops references to deleted blocks from every workflow group on every table
 * that targets the just-deployed workflow. Called from the workflow deploy
 * orchestrator after the new deployment commits, so the table UI never holds
 * stale `{blockId, path}` entries for blocks the user removed.
 *
 * - Filters `outputs[]` per group. If every output would be filtered out, the
 *   group is left untouched and a warning is logged — the user must
 *   reconfigure it manually.
 * - Scoped to the workflow's workspace.
 * - Idempotent: running twice with the same `validBlockIds` is a no-op on the
 *   second pass. Existing row data is left alone.
 */
export async function pruneStaleWorkflowGroupOutputs({
  workflowId,
  workspaceId,
  validBlockIds,
  requestId,
  tx,
}: {
  workflowId: string
  workspaceId: string
  validBlockIds: Set<string>
  requestId: string
  tx?: DbOrTx
}): Promise<void> {
  const executor = tx ?? db
  const tables = await executor
    .select({
      id: userTableDefinitions.id,
      schema: userTableDefinitions.schema,
    })
    .from(userTableDefinitions)
    .where(
      and(
        eq(userTableDefinitions.workspaceId, workspaceId),
        isNull(userTableDefinitions.archivedAt)
      )
    )

  for (const t of tables) {
    const schema = t.schema as TableSchema
    const groups = schema.workflowGroups ?? []
    if (groups.length === 0) continue

    let mutated = false
    const nextGroups = groups.map((group) => {
      if (group.workflowId !== workflowId) return group
      const filtered = group.outputs.filter((o) => validBlockIds.has(o.blockId))
      if (filtered.length === group.outputs.length) return group
      if (filtered.length === 0) {
        logger.warn(
          `[${requestId}] All outputs for workflow group "${group.name ?? group.id}" in table ${t.id} reference deleted blocks; leaving group intact for user reconfiguration.`
        )
        return group
      }
      mutated = true
      return { ...group, outputs: filtered }
    })

    if (!mutated) continue

    await executor
      .update(userTableDefinitions)
      .set({
        schema: { ...schema, workflowGroups: nextGroups },
        updatedAt: new Date(),
      })
      .where(eq(userTableDefinitions.id, t.id))

    logger.info(`[${requestId}] Pruned stale workflow=${workflowId} block refs from table ${t.id}`)
  }
}

/**
 * Restores an archived table.
 */
export async function restoreTable(tableId: string, requestId: string): Promise<void> {
  const table = await getTableById(tableId, { includeArchived: true })
  if (!table) {
    throw new Error('Table not found')
  }

  if (!table.archivedAt) {
    throw new Error('Table is not archived')
  }

  if (table.workspaceId) {
    const { getWorkspaceWithOwner } = await import('@/lib/workspaces/permissions/utils')
    const ws = await getWorkspaceWithOwner(table.workspaceId)
    if (!ws || ws.archivedAt) {
      throw new Error('Cannot restore table into an archived workspace')
    }
  }

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
        await tx.execute(sql`SELECT 1 FROM user_table_definitions WHERE id = ${tableId} FOR UPDATE`)

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
          .set({ archivedAt: null, updatedAt: now, name: attemptedRestoreName })
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
}

/** One batch of rows for a background import (see {@link bulkInsertImportBatch}). */
export interface BulkImportBatch {
  tableId: string
  workspaceId: string
  userId?: string
  rows: RowData[]
  /** Position of the first row in this batch; rows get contiguous positions from here. */
  startPosition: number
  /** Previous batch's last `order_key` (the append anchor); null for the first batch / empty table. */
  afterOrderKey?: string | null
}

/**
 * Inserts one batch of rows for an async import in a single committed statement.
 *
 * Differs from {@link batchInsertRowsWithTx} for the bulk-load case: caller-supplied
 * contiguous positions (no `acquireTablePositionLock` / `nextAutoPosition` scan — an
 * import owns its hidden table as the sole writer), no `RETURNING`, and **no
 * `fireTableTrigger` / `runWorkflowColumn`** (a 1M-row import must not dispatch a
 * workflow run per row). `row_count` is maintained set-based by the statement-level
 * trigger. There is no surrounding transaction and no rollback: each batch commits on
 * its own, so committed batches persist even if a later batch fails.
 *
 * Throws on row-size/schema/unique violations or if the statement-level trigger rejects
 * the batch for crossing `max_rows`; the caller marks the import failed.
 */
export async function bulkInsertImportBatch(
  data: BulkImportBatch,
  table: TableDefinition,
  requestId: string
): Promise<{ inserted: number; lastOrderKey: string | null }> {
  for (let i = 0; i < data.rows.length; i++) {
    const sizeValidation = validateRowSize(data.rows[i])
    if (!sizeValidation.valid) {
      throw new Error(`Row ${i + 1}: ${sizeValidation.errors.join(', ')}`)
    }
    const schemaValidation = coerceRowToSchema(data.rows[i], table.schema)
    if (!schemaValidation.valid) {
      throw new Error(`Row ${i + 1}: ${schemaValidation.errors.join(', ')}`)
    }
  }

  const uniqueColumns = getUniqueColumns(table.schema)
  if (uniqueColumns.length > 0) {
    const uniqueResult = await checkBatchUniqueConstraintsDb(
      data.tableId,
      data.rows,
      table.schema,
      db
    )
    if (!uniqueResult.valid) {
      throw new Error(
        uniqueResult.errors.map((e) => `Row ${e.row + 1}: ${e.errors.join(', ')}`).join('; ')
      )
    }
  }

  const now = new Date()
  // Import worker is the table's sole writer; append keys after the anchor the caller threads
  // from the previous batch's last key — no per-batch max(order_key) scan over a growing table.
  const orderKeys = nKeysBetween(data.afterOrderKey ?? null, null, data.rows.length)
  const rowsToInsert = data.rows.map((rowData, i) => ({
    id: `row_${generateId().replace(/-/g, '')}`,
    tableId: data.tableId,
    workspaceId: data.workspaceId,
    data: rowData,
    position: data.startPosition + i,
    orderKey: orderKeys[i],
    createdAt: now,
    updatedAt: now,
    ...(data.userId ? { createdBy: data.userId } : {}),
  }))

  await db.insert(userTableRows).values(rowsToInsert)
  logger.info(`[${requestId}] Bulk-imported ${rowsToInsert.length} rows into table ${data.tableId}`)
  return {
    inserted: rowsToInsert.length,
    lastOrderKey: orderKeys[orderKeys.length - 1] ?? data.afterOrderKey ?? null,
  }
}

/** Deletes every row of a table (set-based; the statement-level trigger zeroes `row_count`). */
export async function deleteAllTableRows(tableId: string): Promise<void> {
  await db.delete(userTableRows).where(eq(userTableRows.tableId, tableId))
}

/**
 * Adds columns to a table during an import (the `createColumns` flow), wrapping the
 * tx-bound {@link addTableColumnsWithTx} in its own transaction. Returns the updated table.
 */
export async function addImportColumns(
  table: TableDefinition,
  additions: { name: string; type: string }[],
  requestId: string
): Promise<TableDefinition> {
  return db.transaction((trx) => addTableColumnsWithTx(trx, table, additions, requestId))
}

/** Overwrites a table's schema during an import (used when inferring columns from the file). */
export async function setTableSchemaForImport(tableId: string, schema: TableSchema): Promise<void> {
  await db
    .update(userTableDefinitions)
    .set({ schema, updatedAt: new Date() })
    .where(eq(userTableDefinitions.id, tableId))
}

/**
 * Owns the append-import transaction so the API route never holds a `trx`:
 * optionally creates the new columns, then inserts every row in CSV-sized
 * batches — all atomic. Caller fires {@link dispatchAfterBatchInsert} after this
 * resolves (post-commit), mirroring the other batch-insert sites.
 */
export async function importAppendRows(
  table: TableDefinition,
  additions: { id?: string; name: string; type: string; required?: boolean; unique?: boolean }[],
  rows: RowData[],
  ctx: { workspaceId: string; userId?: string; requestId: string }
): Promise<{ inserted: TableRow[]; table: TableDefinition }> {
  return db.transaction(async (trx) => {
    let working = table
    if (additions.length > 0) {
      // Take the row-order lock before creating columns so this path uses the
      // same rows_pos → user_table_definitions order as plain inserts. Creating
      // columns first would lock the definition row before rows_pos, inverting
      // the order and deadlocking concurrent inserts on this table. The lock is
      // re-entrant, so the per-batch acquire below is a no-op.
      await acquireRowOrderLock(trx, table.id)
      working = await addTableColumnsWithTx(trx, table, additions, ctx.requestId)
    }
    const inserted: TableRow[] = []
    for (let i = 0; i < rows.length; i += CSV_MAX_BATCH_SIZE) {
      const batch = rows.slice(i, i + CSV_MAX_BATCH_SIZE)
      const batchInserted = await batchInsertRowsWithTx(
        trx,
        { tableId: working.id, rows: batch, workspaceId: ctx.workspaceId, userId: ctx.userId },
        working,
        generateId().slice(0, 8)
      )
      inserted.push(...batchInserted)
    }
    return { inserted, table: working }
  })
}

/**
 * Owns the replace-import transaction: optionally creates the new columns, then
 * replaces all rows — atomically. Keeps `trx` out of the API route.
 */
export async function importReplaceRows(
  table: TableDefinition,
  additions: { id?: string; name: string; type: string; required?: boolean; unique?: boolean }[],
  data: { rows: RowData[]; workspaceId: string; userId?: string },
  requestId: string
): Promise<ReplaceRowsResult> {
  return db.transaction(async (trx) => {
    let working = table
    if (additions.length > 0) {
      await acquireRowOrderLock(trx, table.id)
      working = await addTableColumnsWithTx(trx, table, additions, requestId)
    }
    return replaceTableRowsWithTx(
      trx,
      { tableId: working.id, rows: data.rows, workspaceId: data.workspaceId, userId: data.userId },
      working,
      requestId
    )
  })
}

/**
 * Atomically inserts a workflow group plus its output columns into a table's
 * schema. Both arrays update in one DB write so the schema is never observed
 * mid-mutation (e.g. columns referencing a group that doesn't yet exist).
 */
export async function addWorkflowGroup(
  data: AddWorkflowGroupData,
  requestId: string
): Promise<TableDefinition> {
  const updatedTable = await withLockedTable(data.tableId, async (table, trx) => {
    const schema = table.schema
    const groups = schema.workflowGroups ?? []
    if (groups.some((g) => g.id === data.group.id)) {
      throw new Error(`Workflow group "${data.group.id}" already exists`)
    }

    const existingNames = new Set(schema.columns.map((c) => c.name.toLowerCase()))
    for (const col of data.outputColumns) {
      if (!NAME_PATTERN.test(col.name)) {
        throw new Error(
          `Invalid output column name "${col.name}". Must satisfy ${NAME_PATTERN.source}.`
        )
      }
      if (existingNames.has(col.name.toLowerCase())) {
        throw new Error(`Column "${col.name}" already exists`)
      }
    }

    if (schema.columns.length + data.outputColumns.length > TABLE_LIMITS.MAX_COLUMNS_PER_TABLE) {
      throw new Error(
        `Adding ${data.outputColumns.length} columns would exceed the maximum (${TABLE_LIMITS.MAX_COLUMNS_PER_TABLE}).`
      )
    }

    // Assign stable ids to the new output columns, then rewrite the group's
    // column refs from name → id so outputs/deps/inputMappings key on ids —
    // matching the row-data storage key and surviving future renames.
    const outputColumns = data.outputColumns.map((col) =>
      col.id ? col : { ...col, id: generateColumnId() }
    )
    const updatedColumns = [...schema.columns, ...outputColumns]
    const idByName = new Map(updatedColumns.map((c) => [c.name, getColumnId(c)]))
    const group = remapGroupColumnRefs(data.group, idByName)

    const updatedSchema: TableSchema = {
      ...schema,
      columns: updatedColumns,
      workflowGroups: [...groups, group],
    }

    // Keep `metadata.columnOrder` (column ids) in sync — see `addTableColumn`.
    // New output columns get appended in the order the caller supplied.
    const existingOrder = table.metadata?.columnOrder
    let updatedMetadata = table.metadata
    if (existingOrder && existingOrder.length > 0) {
      const known = new Set(existingOrder)
      const append = outputColumns.map(getColumnId).filter((id) => !known.has(id))
      if (append.length > 0) {
        updatedMetadata = { ...table.metadata, columnOrder: [...existingOrder, ...append] }
      }
    }

    assertValidSchema(updatedSchema, updatedMetadata?.columnOrder)

    const now = new Date()
    await trx
      .update(userTableDefinitions)
      .set({ schema: updatedSchema, metadata: updatedMetadata, updatedAt: now })
      .where(eq(userTableDefinitions.id, data.tableId))

    logger.info(
      `[${requestId}] Added workflow group "${data.group.id}" with ${data.outputColumns.length} output column(s) to table ${data.tableId}`
    )

    return {
      ...table,
      schema: updatedSchema,
      metadata: updatedMetadata,
      updatedAt: now,
    }
  })

  // Auto-fire existing rows whose deps are already met for the new group.
  // Fire-and-forget — the dispatcher bounds queue depth (window of 20) and
  // walks the table in the background. HTTP returns instantly; cells fill
  // in over the next minutes as the dispatcher walks. Mothership opts out
  // by setting `autoRun: false`.
  if (data.autoRun !== false) {
    void runWorkflowColumn({
      tableId: updatedTable.id,
      workspaceId: updatedTable.workspaceId,
      mode: 'new',
      isManualRun: false,
      groupIds: [data.group.id],
      requestId,
      triggeredByUserId: data.actorUserId,
    }).catch((err) => logger.error(`[${requestId}] auto-dispatch (addWorkflowGroup) failed:`, err))
  }

  return updatedTable
}

/**
 * Updates a workflow group: any combination of workflowId, name, dependencies,
 * outputs[]. Computes added/removed outputs vs current state and inserts /
 * removes columns transactionally. Removed outputs also clear their key from
 * every row's `data`.
 */
export async function updateWorkflowGroup(
  data: UpdateWorkflowGroupData,
  requestId: string
): Promise<TableDefinition> {
  const mappingUpdates = data.mappingUpdates ?? []

  // Phase 1 (no lock): when there are mapping updates, load the workflow once to
  // resolve each remap's new leaf type. Kept OFF the advisory-lock critical
  // section so concurrent group edits on the same table don't time out waiting
  // on this DB load. Best-effort — a resolution failure leaves column types
  // unchanged (workflow deleted, block removed). The result is applied against
  // the fresh schema under the lock in phase 2.
  const remapLeafTypeByColumn = new Map<string, ColumnDefinition['type']>()
  // The workflow id the leaf types above were resolved against. Phase 2 only
  // applies the resolved types if the group still points at this workflow under
  // the lock — a concurrent `workflowId` change would make them stale.
  let resolvedForWorkflowId: string | undefined
  if (mappingUpdates.length > 0) {
    try {
      const preTable = await getTableById(data.tableId)
      const preGroup = preTable?.schema.workflowGroups?.find((g) => g.id === data.groupId)
      const targetWorkflowId = data.workflowId ?? preGroup?.workflowId
      if (targetWorkflowId) {
        resolvedForWorkflowId = targetWorkflowId
        const [
          { loadWorkflowFromNormalizedTables },
          { flattenWorkflowOutputs },
          { columnTypeForLeaf },
        ] = await Promise.all([
          import('@/lib/workflows/persistence/utils'),
          import('@/lib/workflows/blocks/flatten-outputs'),
          import('./column-naming'),
        ])
        const normalized = await loadWorkflowFromNormalizedTables(targetWorkflowId)
        if (normalized) {
          const blocks = Object.values(normalized.blocks ?? {}).map((b) => ({
            id: b.id,
            type: b.type,
            name: b.name,
            triggerMode: (b as { triggerMode?: boolean }).triggerMode,
            subBlocks: b.subBlocks as Record<string, unknown> | undefined,
          }))
          const flattened = flattenWorkflowOutputs(blocks, normalized.edges ?? [])
          const flatByKey = new Map(flattened.map((f) => [`${f.blockId}::${f.path}`, f]))
          for (const u of mappingUpdates) {
            const match = flatByKey.get(`${u.blockId}::${u.path}`)
            if (!match) continue
            const newType = columnTypeForLeaf(match.leafType)
            if (newType) remapLeafTypeByColumn.set(u.columnName, newType)
          }
        }
      }
    } catch (err) {
      logger.warn(
        `[${requestId}] Could not resolve new leaf types for remap on group ${data.groupId}; leaving column types unchanged:`,
        err
      )
    }
  }

  const { updatedTable, added, remappedColumnIds, newOutputs, previousAutoRun } =
    await withLockedTable(data.tableId, async (table, trx) => {
      await setTableTxTimeouts(trx, { statementMs: 60_000 })

      const schema = table.schema
      const groups = schema.workflowGroups ?? []
      const groupIndex = groups.findIndex((g) => g.id === data.groupId)
      if (groupIndex === -1) {
        throw new Error(`Workflow group "${data.groupId}" not found`)
      }
      const group = groups[groupIndex]

      // Normalize every caller-supplied column reference to its stable id, so
      // the diff/splice/clear logic below operates uniformly in id-space (the
      // row-data storage key). New output columns get ids first; then output
      // `columnName`, deps, input mappings, and mapping-update targets are
      // remapped name → id. Callers that already pass ids are unaffected.
      const newColDefs = (data.newOutputColumns ?? []).map((col) =>
        col.id ? col : { ...col, id: generateColumnId() }
      )
      const idByName = new Map(
        [...schema.columns, ...newColDefs].map((c) => [c.name, getColumnId(c)])
      )
      const remapRef = (ref: string) => idByName.get(ref) ?? ref
      const outputsInput = data.outputs?.map((o) => ({ ...o, columnName: remapRef(o.columnName) }))
      const dependenciesInput = data.dependencies
        ? { columns: data.dependencies.columns?.map(remapRef) }
        : undefined
      const inputMappingsInput = data.inputMappings?.map((m) => ({
        ...m,
        columnName: remapRef(m.columnName),
      }))
      const mappingUpdatesNorm = mappingUpdates.map((u) => ({
        ...u,
        columnName: remapRef(u.columnName),
      }))
      // Re-key the out-of-lock leaf-type resolution to ids to match.
      const remapLeafTypeById = new Map<string, ColumnDefinition['type']>()
      for (const [name, type] of remapLeafTypeByColumn) remapLeafTypeById.set(remapRef(name), type)

      // Apply `mappingUpdates` first: each entry repoints an existing output's
      // `(blockId, path)` while preserving the column. We patch the **old** view
      // of outputs so the downstream `(blockId, path)`-keyed diff doesn't see the
      // swap as a remove+add. The corresponding row data is cleared after the
      // schema write so stale values from the old source don't linger.
      const remappedColumnIds = new Set<string>()
      // Per-column type override (keyed by id) resolved (out-of-lock) from the
      // new mapping's leaf type. Only populated when a remap actually changes
      // the column's type against the fresh schema.
      const remappedColumnTypes = new Map<string, ColumnDefinition['type']>()
      let oldOutputs = group.outputs
      if (mappingUpdatesNorm.length > 0) {
        const updateById = new Map(mappingUpdatesNorm.map((u) => [u.columnName, u]))
        for (const u of mappingUpdatesNorm) {
          const exists = oldOutputs.some((o) => o.columnName === u.columnName)
          if (!exists) {
            throw new Error(
              `Mapping update for unknown column "${u.columnName}" (group ${data.groupId}).`
            )
          }
        }
        oldOutputs = oldOutputs.map((o) => {
          const u = updateById.get(o.columnName)
          if (!u) return o
          remappedColumnIds.add(o.columnName)
          return { ...o, blockId: u.blockId, path: u.path }
        })

        // Only apply the out-of-lock leaf-type resolution if the group still
        // points at the workflow we resolved against. If a concurrent writer
        // changed `workflowId` between phase 1 and now, those types are stale —
        // leave column types unchanged (best-effort, same as a resolution
        // failure) rather than stamping types from the old workflow.
        const finalWorkflowId = data.workflowId ?? group.workflowId
        if (remapLeafTypeById.size > 0 && resolvedForWorkflowId !== finalWorkflowId) {
          logger.warn(
            `[${requestId}] Workflow group "${data.groupId}" workflowId changed between leaf-type resolution and apply; leaving remapped column types unchanged.`
          )
        } else {
          const colById = new Map(schema.columns.map((c) => [getColumnId(c), c]))
          for (const u of mappingUpdatesNorm) {
            const newType = remapLeafTypeById.get(u.columnName)
            if (!newType) continue
            const oldType = colById.get(u.columnName)?.type
            if (newType !== oldType) {
              remappedColumnTypes.set(u.columnName, newType)
            }
          }
        }
      }

      // If the caller passed `outputs`, that's the new full set. If only
      // `mappingUpdates` was sent, the new set is the remapped old set.
      const newOutputs = outputsInput ?? oldOutputs
      // Enrichment outputs all share empty `blockId`/`path`, so keying on those
      // alone collapses every sibling to one entry (dropping columns on diff). Key
      // on the registry `outputId` when present; fall back to `blockId::path` for
      // workflow outputs.
      const oldKey = (o: WorkflowGroupOutput) =>
        o.outputId ? `out::${o.outputId}` : `${o.blockId}::${o.path}`
      const oldByKey = new Map(oldOutputs.map((o) => [oldKey(o), o]))
      const newByKey = new Map(newOutputs.map((o) => [oldKey(o), o]))

      const removed = oldOutputs.filter((o) => !newByKey.has(oldKey(o)))
      const added = newOutputs.filter((o) => !oldByKey.has(oldKey(o)))
      const newColById = new Map(newColDefs.map((c) => [getColumnId(c), c]))

      for (const out of added) {
        if (!newColById.has(out.columnName)) {
          throw new Error(
            `Missing column definition for new output "${out.columnName}" (group ${data.groupId}).`
          )
        }
      }

      const removedColumnIds = new Set(removed.map((o) => o.columnName))
      let nextColumns = schema.columns
        .filter((c) => !removedColumnIds.has(getColumnId(c)))
        .map((c) => {
          const newType = remappedColumnTypes.get(getColumnId(c))
          return newType ? { ...c, type: newType } : c
        })
      if (newColDefs.length > 0) {
        // Splice the new column defs into the group's contiguous run rather than
        // appending at the end. The desired in-group order is `newOutputs` (the
        // sidebar's BFS-of-the-workflow ordering); we walk it, anchor at the first
        // surviving sibling's index in `nextColumns`, and emit each output's
        // column def in turn.
        const groupColIds = new Set(newOutputs.map((o) => o.columnName))
        const firstGroupIdx = nextColumns.findIndex((c) => groupColIds.has(getColumnId(c)))
        const anchorIdx = firstGroupIdx === -1 ? nextColumns.length : firstGroupIdx
        const orderedGroupCols: ColumnDefinition[] = []
        for (const out of newOutputs) {
          const fresh = newColById.get(out.columnName)
          if (fresh) {
            orderedGroupCols.push(fresh)
          } else {
            const existing = nextColumns.find((c) => getColumnId(c) === out.columnName)
            if (existing) orderedGroupCols.push(existing)
          }
        }
        const remaining = nextColumns.filter((c) => !groupColIds.has(getColumnId(c)))
        nextColumns = [
          ...remaining.slice(0, anchorIdx),
          ...orderedGroupCols,
          ...remaining.slice(anchorIdx),
        ]
      }

      const updatedGroup: WorkflowGroup = {
        ...group,
        workflowId: data.workflowId ?? group.workflowId,
        name: data.name ?? group.name,
        dependencies: dependenciesInput ?? group.dependencies,
        outputs: newOutputs,
        ...(inputMappingsInput !== undefined ? { inputMappings: inputMappingsInput } : {}),
        ...(data.deploymentMode !== undefined ? { deploymentMode: data.deploymentMode } : {}),
        ...(data.type !== undefined ? { type: data.type } : {}),
        ...(data.autoRun !== undefined ? { autoRun: data.autoRun } : {}),
      }
      // Removed outputs may be referenced as deps by sibling groups; strip those
      // refs so we don't leave dangling-column deps that fail schema validation.
      const nextGroups = groups
        .map((g, i) => (i === groupIndex ? updatedGroup : g))
        .map((g) => (g.id === updatedGroup.id ? g : stripGroupDeps(g, removedColumnIds)))
      const updatedSchema: TableSchema = {
        ...schema,
        columns: nextColumns,
        workflowGroups: nextGroups,
      }

      // `columnOrder` (column ids) mirrors the schema layout. Drop removed
      // columns, then splice the new ones in at the same anchor as `nextColumns`
      // so the table renders them inside the group's contiguous run.
      let updatedColumnOrder = table.metadata?.columnOrder?.filter(
        (id) => !removedColumnIds.has(id)
      )
      if (updatedColumnOrder && newColDefs.length > 0) {
        const newColIds = new Set(newColDefs.map(getColumnId))
        const orderWithoutNew = updatedColumnOrder.filter((id) => !newColIds.has(id))
        const groupColIds = new Set(newOutputs.map((o) => o.columnName))
        const orderedGroupIds = newOutputs.map((o) => o.columnName)
        const firstGroupOrderIdx = orderWithoutNew.findIndex((id) => groupColIds.has(id))
        const anchorOrderIdx =
          firstGroupOrderIdx === -1 ? orderWithoutNew.length : firstGroupOrderIdx
        const remainingOrder = orderWithoutNew.filter((id) => !groupColIds.has(id))
        updatedColumnOrder = [
          ...remainingOrder.slice(0, anchorOrderIdx),
          ...orderedGroupIds,
          ...remainingOrder.slice(anchorOrderIdx),
        ]
      }
      assertValidSchema(updatedSchema, updatedColumnOrder)

      const updatedMetadata: TableMetadata | null =
        updatedColumnOrder && table.metadata
          ? { ...table.metadata, columnOrder: updatedColumnOrder }
          : table.metadata
            ? { ...table.metadata }
            : null

      const now = new Date()
      await trx
        .update(userTableDefinitions)
        .set({ schema: updatedSchema, metadata: updatedMetadata, updatedAt: now })
        .where(eq(userTableDefinitions.id, data.tableId))
      for (const id of removedColumnIds) {
        await trx.execute(
          sql`UPDATE user_table_rows SET data = data - ${id}::text WHERE table_id = ${data.tableId} AND data ? ${id}::text`
        )
      }
      // Remapped columns: clear stale values in-tx so rows the backfill can't
      // repopulate (no log, no matching span output) end up empty rather than
      // retaining the previous mapping's value. The backfill below then writes
      // the new mapping's value into rows where it can find one.
      for (const id of remappedColumnIds) {
        if (removedColumnIds.has(id)) continue
        await trx.execute(
          sql`UPDATE user_table_rows SET data = data - ${id}::text WHERE table_id = ${data.tableId} AND data ? ${id}::text`
        )
      }

      logger.info(
        `[${requestId}] Updated workflow group "${data.groupId}" in table ${data.tableId} (added=${added.length}, removed=${removed.length}, remapped=${remappedColumnIds.size})`
      )

      const updatedTable: TableDefinition = {
        ...table,
        schema: updatedSchema,
        metadata: updatedMetadata,
        updatedAt: now,
      }
      return {
        updatedTable,
        added,
        remappedColumnIds,
        newOutputs,
        previousAutoRun: group.autoRun,
      }
    })

  // Backfill from saved execution logs so already-completed group runs surface
  // the schema changes without re-running the workflow. Two passes:
  //   - added outputs (new columns): never overwrite hand-edited values.
  //   - remapped outputs (existing column re-pointed): overwrite, since the
  //     new mapping is the source of truth and the user expects the cell to
  //     refresh to the new output's value.
  // Small tables backfill inline-awaited (response returns with consistent
  // data); large ones run as a background job. A failed backfill is logged
  // but doesn't fail the request — the schema change has already committed.
  // Lazy import: backfill-runner closes a cycle back to this module.
  const { maybeBackfillGroupOutputs } = await import('./backfill-runner')
  if (added.length > 0) {
    try {
      await maybeBackfillGroupOutputs({
        table: updatedTable,
        groupId: data.groupId,
        outputs: added,
        overwrite: false,
        requestId,
        actorUserId: data.actorUserId,
      })
    } catch (err) {
      logger.warn(
        `[${requestId}] Backfill from execution logs failed for ${data.tableId} group ${data.groupId}:`,
        err
      )
    }
  }
  if (remappedColumnIds.size > 0) {
    const remappedOutputs = newOutputs.filter((o) => remappedColumnIds.has(o.columnName))
    try {
      await maybeBackfillGroupOutputs({
        table: updatedTable,
        groupId: data.groupId,
        outputs: remappedOutputs,
        overwrite: true,
        requestId,
        actorUserId: data.actorUserId,
      })
    } catch (err) {
      logger.warn(
        `[${requestId}] Remap backfill from execution logs failed for ${data.tableId} group ${data.groupId}:`,
        err
      )
    }
  }

  // autoRun toggled false → true: fire deps-satisfied rows now via the
  // dispatcher. Mirrors the post-add path so re-enabling auto-fire doesn't
  // require manual run clicks for rows that are already eligible.
  if (previousAutoRun === false && data.autoRun === true) {
    void runWorkflowColumn({
      tableId: updatedTable.id,
      workspaceId: updatedTable.workspaceId,
      mode: 'new',
      isManualRun: false,
      groupIds: [data.groupId],
      requestId,
      triggeredByUserId: data.actorUserId,
    }).catch((err) =>
      logger.error(`[${requestId}] auto-dispatch (updateWorkflowGroup autoRun=true) failed:`, err)
    )
  }

  return updatedTable
}

/**
 * Adds a single output to an existing workflow group. Mirrors `addTableColumn`
 * for plain columns: one canonical op, one column created, type inferred from
 * the workflow's flattened outputs (`leafType` for `(blockId, path)`). The
 * column is spliced into the group's contiguous run so the table renders the
 * new output next to its siblings.
 */
export async function addWorkflowGroupOutput(
  data: {
    tableId: string
    groupId: string
    blockId: string
    path: string
    /** Optional override; defaults to a slug derived from `path`. */
    columnName?: string
    /** The member adding the output — billed/gated for any backfill-triggered re-run. */
    actorUserId?: string | null
  },
  requestId: string
): Promise<TableDefinition> {
  // Phase 1 (no lock): load the workflow and resolve the pickable output plus
  // its execution-order index. This depends only on the workflow graph (which
  // is stable), so it runs OFF the advisory-lock critical section — holding the
  // lock during this DB load would make concurrent adders on the same table
  // time out waiting (the Mothership fan-out this fix targets). Phase 2
  // re-validates that the group still maps to the same workflow under the lock.
  const preTable = await getTableById(data.tableId)
  if (!preTable) throw new Error('Table not found')
  const preGroup = (preTable.schema.workflowGroups ?? []).find((g) => g.id === data.groupId)
  if (!preGroup) {
    throw new Error(`Workflow group "${data.groupId}" not found`)
  }
  const workflowId = preGroup.workflowId

  const [
    { loadWorkflowFromNormalizedTables },
    { flattenWorkflowOutputs, getBlockExecutionOrder },
    { columnTypeForLeaf, deriveOutputColumnName },
  ] = await Promise.all([
    import('@/lib/workflows/persistence/utils'),
    import('@/lib/workflows/blocks/flatten-outputs'),
    import('./column-naming'),
  ])
  const normalized = await loadWorkflowFromNormalizedTables(workflowId)
  if (!normalized) {
    throw new Error(`Workflow ${workflowId} not found`)
  }
  const blocks = Object.values(normalized.blocks ?? {}).map((b) => ({
    id: b.id,
    type: b.type,
    name: b.name,
    triggerMode: (b as { triggerMode?: boolean }).triggerMode,
    subBlocks: b.subBlocks as Record<string, unknown> | undefined,
  }))
  const flattened = flattenWorkflowOutputs(blocks, normalized.edges ?? [])
  const match = flattened.find((f) => f.blockId === data.blockId && f.path === data.path)
  if (!match) {
    throw new Error(
      `Output ${data.blockId}::${data.path} is not a valid pickable output on workflow ${workflowId}`
    )
  }
  const newColumnType = columnTypeForLeaf(match.leafType)
  const distances = getBlockExecutionOrder(blocks, normalized.edges ?? [])
  const flatIndex = new Map(flattened.map((f, i) => [`${f.blockId}::${f.path}`, i]))

  // Phase 2 (locked): re-read fresh, validate against the current schema, and
  // write. The critical section holds no I/O — just the in-memory splice + the
  // schema UPDATE — so concurrent adders queue behind it quickly.
  const { updatedTable, newOutput } = await withLockedTable(data.tableId, async (table, trx) => {
    const schema = table.schema
    const groups = schema.workflowGroups ?? []
    const groupIndex = groups.findIndex((g) => g.id === data.groupId)
    if (groupIndex === -1) {
      throw new Error(`Workflow group "${data.groupId}" not found`)
    }
    const group = groups[groupIndex]
    if (group.workflowId !== workflowId) {
      throw new Error(
        `Workflow group "${data.groupId}" was remapped to a different workflow concurrently; retry the add.`
      )
    }

    if (group.outputs.some((o) => o.blockId === data.blockId && o.path === data.path)) {
      throw new Error(
        `Workflow group "${data.groupId}" already has an output at ${data.blockId}::${data.path}`
      )
    }

    const taken = new Set(schema.columns.map((c) => c.name))
    const columnName = data.columnName ?? deriveOutputColumnName(data.path, taken)
    if (!NAME_PATTERN.test(columnName)) {
      throw new Error(`Invalid column name "${columnName}". Must satisfy ${NAME_PATTERN.source}.`)
    }
    if (taken.has(columnName)) {
      throw new Error(`Column "${columnName}" already exists`)
    }
    if (schema.columns.length + 1 > TABLE_LIMITS.MAX_COLUMNS_PER_TABLE) {
      throw new Error(
        `Adding a column would exceed the maximum (${TABLE_LIMITS.MAX_COLUMNS_PER_TABLE}).`
      )
    }

    const newColDef: ColumnDefinition = {
      id: generateColumnId(),
      name: columnName,
      type: newColumnType,
      required: false,
      unique: false,
      workflowGroupId: data.groupId,
    }
    const newColumnId = getColumnId(newColDef)
    const newOutput: WorkflowGroupOutput = {
      blockId: data.blockId,
      path: data.path,
      columnName: newColumnId,
    }

    // Sort all of the group's outputs (existing + new) in workflow execution
    // order: BFS distance from the start block ASC, with discovery order as
    // tiebreak. This matches what the column-sidebar does at create time, so
    // columns from the same workflow always read in the order their blocks run
    // — regardless of whether they were added at create time or one-by-one.
    const groupColIdsBefore = new Set(group.outputs.map((o) => o.columnName))
    const orderKey = (o: { blockId: string; path: string }) => {
      const d = distances[o.blockId]
      const dist = d === undefined || d < 0 ? Number.POSITIVE_INFINITY : d
      const idx = flatIndex.get(`${o.blockId}::${o.path}`) ?? Number.POSITIVE_INFINITY
      return [dist, idx] as const
    }
    const allGroupOutputs = [...group.outputs, newOutput].sort((a, b) => {
      const [da, ia] = orderKey(a)
      const [db, ib] = orderKey(b)
      return da !== db ? da - db : ia - ib
    })
    const orderedGroupColIds = allGroupOutputs.map((o) => o.columnName)
    const updatedGroup: WorkflowGroup = {
      ...group,
      outputs: allGroupOutputs,
    }
    const nextGroups = groups.map((g, i) => (i === groupIndex ? updatedGroup : g))

    // Splice the new column run into nextColumns: keep the columns outside the
    // group where they were, replace the group's contiguous run with the
    // BFS-ordered list. Anchor at the position of the first existing sibling
    // (or append if the group was empty).
    const colById = new Map(schema.columns.map((c) => [getColumnId(c), c]))
    const orderedGroupCols: ColumnDefinition[] = orderedGroupColIds.map((id) => {
      if (id === newColumnId) return newColDef
      const existing = colById.get(id)
      if (!existing) {
        throw new Error(`Internal: column "${id}" missing while splicing group outputs`)
      }
      return existing
    })
    const remainingCols = schema.columns.filter((c) => !groupColIdsBefore.has(getColumnId(c)))
    const firstGroupIdx = schema.columns.findIndex((c) => groupColIdsBefore.has(getColumnId(c)))
    const colAnchor = firstGroupIdx === -1 ? remainingCols.length : firstGroupIdx
    const nextColumns = [
      ...remainingCols.slice(0, colAnchor),
      ...orderedGroupCols,
      ...remainingCols.slice(colAnchor),
    ]

    const updatedSchema: TableSchema = {
      ...schema,
      columns: nextColumns,
      workflowGroups: nextGroups,
    }

    const updatedColumnOrder = table.metadata?.columnOrder
      ? (() => {
          const orderWithoutGroup = table.metadata!.columnOrder!.filter(
            (id) => !groupColIdsBefore.has(id)
          )
          const firstGroupOrderIdx = table.metadata!.columnOrder!.findIndex((id) =>
            groupColIdsBefore.has(id)
          )
          const orderAnchor =
            firstGroupOrderIdx === -1 ? orderWithoutGroup.length : firstGroupOrderIdx
          return [
            ...orderWithoutGroup.slice(0, orderAnchor),
            ...orderedGroupColIds,
            ...orderWithoutGroup.slice(orderAnchor),
          ]
        })()
      : undefined

    assertValidSchema(updatedSchema, updatedColumnOrder)

    const updatedMetadata: TableMetadata | null =
      updatedColumnOrder && table.metadata
        ? { ...table.metadata, columnOrder: updatedColumnOrder }
        : table.metadata
          ? { ...table.metadata }
          : null

    const now = new Date()
    await trx
      .update(userTableDefinitions)
      .set({ schema: updatedSchema, metadata: updatedMetadata, updatedAt: now })
      .where(eq(userTableDefinitions.id, data.tableId))

    logger.info(
      `[${requestId}] Added output "${columnName}" (${newColDef.type}) to workflow group "${data.groupId}" in table ${data.tableId}`
    )

    const updatedTable: TableDefinition = {
      ...table,
      schema: updatedSchema,
      metadata: updatedMetadata,
      updatedAt: now,
    }
    return { updatedTable, newOutput }
  })

  // Backfill from saved execution logs — same flow `updateWorkflowGroup`
  // uses for added outputs. Reads each row's saved trace spans for the
  // group's executionId and writes the new output's value back. Existing
  // rows that have hand-edited values are left alone (overwrite: false).
  // Cheap compared to re-running the workflow on every row, which is what
  // an earlier version of this code did — that mistakenly fanned out N
  // workflow-group-cell jobs and burned compute the user didn't ask for.
  // Small tables backfill inline; large ones run as a background job.
  // Lazy import: backfill-runner closes a cycle back to this module.
  try {
    const { maybeBackfillGroupOutputs } = await import('./backfill-runner')
    await maybeBackfillGroupOutputs({
      table: updatedTable,
      groupId: data.groupId,
      outputs: [newOutput],
      overwrite: false,
      requestId,
      actorUserId: data.actorUserId,
    })
  } catch (err) {
    logger.warn(
      `[${requestId}] Backfill from execution logs failed for ${data.tableId} group ${data.groupId} after adding output "${newOutput.columnName}":`,
      err
    )
  }

  return updatedTable
}

/**
 * Removes a single output from a workflow group. Drops the bound column and
 * strips the value from every row's `data` JSONB. If the output is the
 * group's last, the empty group is left in place — drop it explicitly with
 * `deleteWorkflowGroup` if needed.
 */
export async function deleteWorkflowGroupOutput(
  data: { tableId: string; groupId: string; columnName: string },
  requestId: string
): Promise<TableDefinition> {
  return withLockedTable(data.tableId, async (table, trx) => {
    const schema = table.schema
    const groups = schema.workflowGroups ?? []
    const groupIndex = groups.findIndex((g) => g.id === data.groupId)
    if (groupIndex === -1) {
      throw new Error(`Workflow group "${data.groupId}" not found`)
    }
    const group = groups[groupIndex]
    // `data.columnName` may be a column id (first-party) or display name
    // (mothership/legacy); resolve to the stable id used everywhere below.
    const targetColumn = schema.columns.find((c) => columnMatchesRef(c, data.columnName))
    const columnId = targetColumn ? getColumnId(targetColumn) : data.columnName
    if (!group.outputs.some((o) => o.columnName === columnId)) {
      throw new Error(
        `Workflow group "${data.groupId}" has no output bound to column "${data.columnName}"`
      )
    }

    const updatedGroup: WorkflowGroup = {
      ...group,
      outputs: group.outputs.filter((o) => o.columnName !== columnId),
    }
    const nextGroups = groups.map((g, i) => (i === groupIndex ? updatedGroup : g))
    const nextColumns = schema.columns.filter((c) => getColumnId(c) !== columnId)
    const updatedSchema: TableSchema = {
      ...schema,
      columns: nextColumns,
      workflowGroups: nextGroups,
    }

    const updatedColumnOrder = table.metadata?.columnOrder?.filter((id) => id !== columnId)
    assertValidSchema(updatedSchema, updatedColumnOrder)

    const updatedMetadata: TableMetadata | null =
      updatedColumnOrder && table.metadata
        ? { ...table.metadata, columnOrder: updatedColumnOrder }
        : table.metadata
          ? { ...table.metadata }
          : null

    const now = new Date()
    await setTableTxTimeouts(trx, { statementMs: 60_000 })
    await trx
      .update(userTableDefinitions)
      .set({ schema: updatedSchema, metadata: updatedMetadata, updatedAt: now })
      .where(eq(userTableDefinitions.id, data.tableId))
    await trx.execute(
      sql`UPDATE user_table_rows SET data = data - ${columnId}::text WHERE table_id = ${data.tableId} AND data ? ${columnId}::text`
    )

    logger.info(
      `[${requestId}] Removed output "${data.columnName}" from workflow group "${data.groupId}" in table ${data.tableId}`
    )

    return { ...table, schema: updatedSchema, metadata: updatedMetadata, updatedAt: now }
  })
}

/**
 * Removes a workflow group plus all its output columns. Also strips the
 * group's `executions[groupId]` entry from every row.
 */
export async function deleteWorkflowGroup(
  data: DeleteWorkflowGroupData,
  requestId: string
): Promise<TableDefinition> {
  return withLockedTable(data.tableId, async (table, trx) => {
    const schema = table.schema
    const groups = schema.workflowGroups ?? []
    const group = groups.find((g) => g.id === data.groupId)
    if (!group) {
      throw new Error(`Workflow group "${data.groupId}" not found`)
    }

    const removedColumnIds = new Set(group.outputs.map((o) => o.columnName))
    // Removed group's output columns may be referenced as deps by sibling groups.
    // Strip those refs so we don't leave dangling-column deps behind.
    const nextGroups = groups
      .filter((g) => g.id !== data.groupId)
      .map((g) => stripGroupDeps(g, removedColumnIds))
    const updatedSchema: TableSchema = {
      ...schema,
      columns: schema.columns.filter((c) => !removedColumnIds.has(getColumnId(c))),
      workflowGroups: nextGroups,
    }
    const updatedColumnOrder = table.metadata?.columnOrder?.filter(
      (id) => !removedColumnIds.has(id)
    )
    assertValidSchema(updatedSchema, updatedColumnOrder)

    const updatedMetadata: TableMetadata | null =
      updatedColumnOrder && table.metadata
        ? { ...table.metadata, columnOrder: updatedColumnOrder }
        : table.metadata
          ? { ...table.metadata }
          : null

    const now = new Date()
    await setTableTxTimeouts(trx, { statementMs: 60_000 })
    await trx
      .update(userTableDefinitions)
      .set({ schema: updatedSchema, metadata: updatedMetadata, updatedAt: now })
      .where(eq(userTableDefinitions.id, data.tableId))
    for (const id of removedColumnIds) {
      await trx.execute(
        sql`UPDATE user_table_rows SET data = data - ${id}::text WHERE table_id = ${data.tableId} AND data ? ${id}::text`
      )
    }
    await stripGroupExecutions(trx, data.tableId, [data.groupId])

    logger.info(
      `[${requestId}] Deleted workflow group "${data.groupId}" from table ${data.tableId}`
    )

    return {
      ...table,
      schema: updatedSchema,
      metadata: updatedMetadata,
      updatedAt: now,
    }
  })
}
