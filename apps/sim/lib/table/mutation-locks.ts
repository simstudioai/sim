/**
 * Per-table mutation-lock enforcement — four independent locks, one per verb.
 *
 * Lives at the `lib/table` service layer, not the routes: Mothership calls these
 * services directly, so route-level asserts would miss it entirely.
 *
 * Non-goals, each load-bearing:
 * - Do NOT re-read the table inside a write tx to close the TOCTOU window. A
 *   `SELECT ... FOR UPDATE` on the definition row reintroduces the per-insert
 *   serialization hotspot migration 0198 removed; `getTableById` without `{ tx }`
 *   takes a second pool connection while holding the first (the billing
 *   pool-starvation shape). Locks gate *starting* a mutation, not a transactional
 *   fence — workspace `write` is still the security boundary.
 * - Integrity, not confidentiality: reads/exports are never blocked, and forking
 *   (admin-gated, the same bar as unlocking) resets locks on the copy.
 * - System writers outside these helpers (fork copy, workspace archive,
 *   soft-delete GC, order-key repair, seeds) must keep writing raw so they are
 *   never blocked.
 */

import { createLogger } from '@sim/logger'
import { HttpError } from '@/lib/core/utils/http-error'
import { getColumnId } from '@/lib/table/column-keys'
import type { RowData, TableDefinition, TableLockKind } from '@/lib/table/types'

const logger = createLogger('TableMutationLocks')

const LOCK_MESSAGES: Record<TableLockKind, string> = {
  schema: 'This table is schema-locked: its columns cannot be changed.',
  insert: 'This table is insert-locked: new rows cannot be added.',
  update: 'This table is update-locked: existing rows cannot be edited.',
  delete: 'This table is delete-locked: rows cannot be deleted.',
}

/**
 * Thrown when a mutation violates a table lock. Extends {@link HttpError} with
 * `statusCode = 423` so `withRouteHandler` forwards the message on routes that
 * don't catch it, and route catch blocks map it via `tableLockErrorResponse`.
 * The message names the lock and is retry-pointless — surface it verbatim.
 */
export class TableLockedError extends HttpError {
  readonly statusCode = 423
  readonly lock: TableLockKind

  constructor(lock: TableLockKind, message?: string) {
    super(message ?? LOCK_MESSAGES[lock])
    this.name = 'TableLockedError'
    this.lock = lock
  }
}

/**
 * An opaque, unforgeable proof that a lock assert ran for a verb. The brand
 * symbol is module-private, so no other module can mint one by object literal
 * or cast — the only source is the `assert*` functions here (and the explicit
 * test/bypass escape hatch). The low-level write primitives in `rows/ordering.ts`
 * require the matching proof, so a new row-write path cannot compile without
 * first asserting.
 */
declare const proofBrand: unique symbol
export interface MutationProof<V extends TableLockKind = TableLockKind> {
  readonly [proofBrand]: V
}

const PROOF = Object.freeze({}) as MutationProof<TableLockKind>

function proofFor<V extends TableLockKind>(): MutationProof<V> {
  return PROOF as MutationProof<V>
}

function logBlocked(table: TableDefinition, lock: TableLockKind): void {
  logger.warn('Table mutation blocked by lock', {
    tableId: table.id,
    workspaceId: table.workspaceId,
    lock,
  })
}

/** Asserts the table permits inserting rows. */
export function assertRowInsert(table: TableDefinition): MutationProof<'insert'> {
  if (table.locks?.insertLocked) {
    logBlocked(table, 'insert')
    throw new TableLockedError('insert')
  }
  return proofFor<'insert'>()
}

/** Asserts the table permits deleting rows. */
export function assertRowDelete(table: TableDefinition): MutationProof<'delete'> {
  if (table.locks?.deleteLocked) {
    logBlocked(table, 'delete')
    throw new TableLockedError('delete')
  }
  return proofFor<'delete'>()
}

/**
 * Asserts the table permits updating existing rows.
 *
 * Two carve-outs keep the update lock meaning "user-authored data is immutable"
 * without breaking the machinery that lives on the same write path:
 *
 * - An **empty data patch** (`columnIds` omitted or empty) is an
 *   executions-only write — cancellation, error/completed status stamps, and
 *   usage-limit pre-stamp clears. These are not row edits; blocking them would
 *   strand cells in `running` forever, so they always pass.
 * - A patch that touches **only workflow-group output columns** is a computed
 *   write (enrichment / workflow column), not a user edit, so it passes even on
 *   an update-locked table. A patch touching any user-authored column is blocked.
 */
export function assertRowUpdate(
  table: TableDefinition,
  columnIds?: readonly string[]
): MutationProof<'update'> {
  if (!table.locks?.updateLocked) return proofFor<'update'>()
  if (!columnIds || columnIds.length === 0) return proofFor<'update'>()
  if (patchTouchesOnlyWorkflowColumns(table, columnIds)) return proofFor<'update'>()
  logBlocked(table, 'update')
  throw new TableLockedError('update')
}

/** Asserts the table permits schema (column / workflow-group) changes. */
export function assertSchemaMutable(table: TableDefinition): MutationProof<'schema'> {
  if (table.locks?.schemaLocked) {
    logBlocked(table, 'schema')
    throw new TableLockedError('schema')
  }
  return proofFor<'schema'>()
}

/**
 * Asserts a **destructive** schema change (dropping or retyping a column, or
 * deleting a workflow group/output). These rewrite `user_table_rows.data` for
 * every row, so they are gated by BOTH the schema lock (structure) and the
 * delete lock (data destruction) — a delete lock therefore genuinely means "no
 * row data disappears by any route", including via column removal.
 */
export function assertColumnDestructive(table: TableDefinition): void {
  assertSchemaMutable(table)
  if (table.locks?.deleteLocked) {
    logBlocked(table, 'delete')
    throw new TableLockedError('delete')
  }
}

/**
 * True when every id in `columnIds` maps to a workflow-group output column in
 * the table's schema. Used by {@link assertRowUpdate} to exempt computed-cell
 * writes from the update lock. An unknown id (not in the schema) counts as
 * user-authored, so it fails closed.
 */
function patchTouchesOnlyWorkflowColumns(
  table: TableDefinition,
  columnIds: readonly string[]
): boolean {
  const workflowColumnIds = new Set<string>()
  for (const col of table.schema.columns) {
    if (col.workflowGroupId) workflowColumnIds.add(getColumnId(col))
  }
  return columnIds.every((id) => workflowColumnIds.has(id))
}

/** Column ids present in a row-data patch, for {@link assertRowUpdate}. */
export function patchColumnIds(data: RowData): string[] {
  return Object.keys(data)
}

/**
 * Escape hatch for tests and trusted system callers that legitimately invoke
 * the low-level `rows/ordering.ts` primitives without a preceding assert
 * (e.g. fixtures, or a call path already gated elsewhere). NOT for production
 * mutation paths — those must assert so locks are enforced and violations logged.
 */
export function unsafeMutationProof<V extends TableLockKind = TableLockKind>(): MutationProof<V> {
  return proofFor<V>()
}
