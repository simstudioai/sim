import { db } from '@sim/db'
import {
  type TableRowSecretProvenanceEntry,
  userTableDefinitions,
  userTableRowSecretProvenance,
  userTableRows,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, asc, eq, gt, inArray, type SQL, sql } from 'drizzle-orm'
import {
  isDurableSecretProvenanceEnforced,
  reportUnrecordedDurableProvenance,
} from '@/lib/execution/durable-secret-provenance-enforcement'
import { SecretProvenanceBudget } from '@/lib/execution/provenance-budget'
import {
  PROVENANCE_MAX_ENTRIES,
  PROVENANCE_MAX_SERIALIZED_BYTES,
} from '@/lib/execution/provenance-limits'
import type { DbExecutor, DbTransaction } from '@/lib/table/planner'
import type { RowData, TableRowSecretProvenanceWrite } from '@/lib/table/types'
import {
  isResolvedSecretTraceProvenanceV1,
  type ResolvedSecretTraceProvenanceEntryV1,
  type ResolvedSecretTraceProvenanceV1,
  ResolvedSecretTraceRegistry,
  type ResolvedSecretTraceScopeV1,
} from '@/executor/utils/resolved-secret-trace-registry'

const logger = createLogger('TableRowSecretProvenance')

export const TABLE_ROW_SECRET_PROVENANCE_VERSION = 1

const QUERY_CHUNK_SIZE = 1_000

type StoredTableRowSecretProvenanceEntry = TableRowSecretProvenanceEntry

interface TableRowCrossing {
  id: string
  updatedAt: Date | string
  selectedValues?: RowData
}

interface TableRowProvenanceMutation {
  rowId: string
  provenance: TableRowSecretProvenanceWrite | undefined
}

type TableRowSecretProvenanceCopyClassification =
  | { mode: 'legacy' }
  | {
      mode: 'tracked'
      status: 'exact' | 'unknown'
      entries: TableRowSecretProvenanceEntry[]
    }

interface TableRowSecretProvenanceCopySource {
  secretProvenanceVersion: number | null
  provenanceIsCurrent: boolean
  provenance?: {
    status: string
    entries: unknown
  } | null
}

interface TableRowMutationOutcome<T> {
  value: T
  affectedRowIds: string[]
}

type MutateTableRowsWithSecretProvenanceOptions<T> = {
  rows: TableRowProvenanceMutation[]
  mutate: () => Promise<TableRowMutationOutcome<T>>
} & ({ rowState: 'new'; mode: 'replace' } | { rowState: 'existing'; mode: 'replace' | 'merge' })

type DerivedTableRowTransformation =
  | { mode: 'preserve'; dataExpression: SQL }
  | { mode: 'remove-columns'; columnIds: string[] }

const STORED_ENTRY_KEYS = new Set([
  'columnId',
  'encryptedValue',
  'name',
  'sourceUserId',
  'sourceWorkspaceId',
])

/**
 * Why a durable table row write could not vouch for the cells it persisted.
 *
 * Shared by ordinary mutations and derived column transformations, so the same event covers
 * every writer rather than only the paths that classify provenance in JavaScript.
 */
type UnvouchedTableRowWriteCause =
  | 'incoming-provenance-incomplete'
  | 'merge-base-unvouchable'
  | 'merge-base-unnormalizable'
  | 'merge-result-unnormalizable'
  | 'derived-base-unvouchable'
  | 'derived-base-unnormalizable'

type UnvouchedTableRowWriteReport = {
  cause: UnvouchedTableRowWriteCause
  workspaceId: string
  tableId: string
  rowCount: number
}

/**
 * Reports rows actually bound by the current transaction, which can still roll back later.
 *
 * Summarised per mutation rather than per row: one incomplete envelope marks every row of a batch,
 * and a batch runs to a thousand rows. Error for the same reason the read side uses it — an
 * unrecorded row is durable, and error is the only level surviving every default the logger falls
 * back to.
 */
function reportUnvouchedTableRowWrite(
  report: UnvouchedTableRowWriteReport,
  mode: 'replace' | 'merge' | DerivedTableRowTransformation['mode']
): void {
  logger.error('Table row write staged unrecorded secret provenance', {
    surface: 'table-row',
    ...report,
    mode,
  })
}

function compareStrings(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function serializedBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8')
}

function isStoredEntry(value: unknown): value is StoredTableRowSecretProvenanceEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (
    Reflect.ownKeys(record).some((key) => typeof key !== 'string' || !STORED_ENTRY_KEYS.has(key))
  ) {
    return false
  }
  return (
    typeof record.columnId === 'string' &&
    record.columnId.length > 0 &&
    typeof record.encryptedValue === 'string' &&
    record.encryptedValue.length > 0 &&
    (record.name === undefined || (typeof record.name === 'string' && record.name.length > 0)) &&
    (record.sourceUserId === undefined ||
      (typeof record.sourceUserId === 'string' && record.sourceUserId.length > 0)) &&
    (record.sourceWorkspaceId === undefined ||
      (typeof record.sourceWorkspaceId === 'string' && record.sourceWorkspaceId.length > 0))
  )
}

function normalizeStoredEntryBindings(
  values: Iterable<unknown>
): StoredTableRowSecretProvenanceEntry[] | undefined {
  const deduplicated = new Map<string, StoredTableRowSecretProvenanceEntry>()
  const budget = new SecretProvenanceBudget()
  for (const entry of values) {
    if (!isStoredEntry(entry)) return undefined
    let minimumBytes = 0
    for (const value of Object.values(entry)) {
      if (typeof value === 'string') minimumBytes += Buffer.byteLength(value, 'utf8')
      if (minimumBytes > PROVENANCE_MAX_SERIALIZED_BYTES) return undefined
    }
    const normalized = {
      columnId: entry.columnId,
      encryptedValue: entry.encryptedValue,
      ...(entry.name ? { name: entry.name } : {}),
      ...(entry.sourceUserId ? { sourceUserId: entry.sourceUserId } : {}),
      ...(entry.sourceWorkspaceId ? { sourceWorkspaceId: entry.sourceWorkspaceId } : {}),
    }
    const key = JSON.stringify(normalized)
    if (deduplicated.has(key)) continue
    if (!budget.add(entry.encryptedValue, Buffer.byteLength(key, 'utf8'))) return undefined
    deduplicated.set(key, normalized)
  }
  return [...deduplicated.values()].sort(
    (left, right) =>
      compareStrings(left.columnId, right.columnId) ||
      compareStrings(left.encryptedValue, right.encryptedValue) ||
      compareStrings(left.name ?? '', right.name ?? '') ||
      compareStrings(left.sourceUserId ?? '', right.sourceUserId ?? '') ||
      compareStrings(left.sourceWorkspaceId ?? '', right.sourceWorkspaceId ?? '')
  )
}

function normalizeStoredEntries(value: unknown): StoredTableRowSecretProvenanceEntry[] | undefined {
  return Array.isArray(value) ? normalizeStoredEntryBindings(value) : undefined
}

function* storedEntriesFromColumns(
  columns: [string, ResolvedSecretTraceProvenanceV1][]
): Generator<StoredTableRowSecretProvenanceEntry> {
  for (const [columnId, provenance] of columns) {
    for (const entry of provenance.entries) {
      yield {
        columnId,
        encryptedValue: entry.encryptedValue,
        ...(entry.name ? { name: entry.name } : {}),
        ...(provenance.scope?.userId ? { sourceUserId: provenance.scope.userId } : {}),
        ...(provenance.scope?.workspaceId
          ? { sourceWorkspaceId: provenance.scope.workspaceId }
          : {}),
      }
    }
  }
}

function* mergedStoredEntries(
  existing: StoredTableRowSecretProvenanceEntry[],
  incoming: StoredTableRowSecretProvenanceEntry[],
  touchedColumns: Set<string>
): Generator<StoredTableRowSecretProvenanceEntry> {
  for (const entry of existing) {
    if (!touchedColumns.has(entry.columnId)) yield entry
  }
  yield* incoming
}

function toStoredEntries(provenance: TableRowSecretProvenanceWrite): {
  complete: boolean
  touchedColumns: Set<string>
  entries: StoredTableRowSecretProvenanceEntry[]
} {
  const columnEntries = Object.entries(provenance.columns)
  const touchedColumns = new Set(columnEntries.map(([columnId]) => columnId))
  if (
    !provenance.complete ||
    columnEntries.some(
      ([columnId, columnProvenance]) =>
        !columnId ||
        !isResolvedSecretTraceProvenanceV1(columnProvenance) ||
        !columnProvenance.complete
    )
  ) {
    return { complete: false, touchedColumns, entries: [] }
  }

  const normalized = normalizeStoredEntryBindings(storedEntriesFromColumns(columnEntries))
  return normalized
    ? { complete: true, touchedColumns, entries: normalized }
    : { complete: false, touchedColumns, entries: [] }
}

function sameTimestamp(left: Date | string, right: Date | string): boolean {
  return new Date(left).getTime() === new Date(right).getTime()
}

function textArrayExpression(values: string[]): SQL {
  return sql`ARRAY[${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `
  )}]::text[]`
}

/** Classifies a source row before a fork can bind its provenance to the copied row. */
export function classifyTableRowSecretProvenanceForCopy(
  source: TableRowSecretProvenanceCopySource
): TableRowSecretProvenanceCopyClassification {
  if (source.secretProvenanceVersion === null) return { mode: 'legacy' }
  const entries = source.provenance ? normalizeStoredEntries(source.provenance.entries) : undefined
  if (
    source.secretProvenanceVersion !== TABLE_ROW_SECRET_PROVENANCE_VERSION ||
    source.provenance?.status !== 'exact' ||
    !source.provenanceIsCurrent ||
    !entries
  ) {
    return { mode: 'tracked', status: 'unknown', entries: [] }
  }
  return { mode: 'tracked', status: 'exact', entries }
}

/** Certifies trusted non-runtime row values without scanning configured secrets. */
export function createExactEmptyTableRowSecretProvenance(
  data: RowData
): TableRowSecretProvenanceWrite {
  return {
    complete: true,
    columns: Object.fromEntries(
      Object.keys(data).map((columnId) => [columnId, { version: 1, complete: true, entries: [] }])
    ),
  }
}

/** Marks a runtime-produced row patch unsafe when its exact provenance is unavailable. */
export function createUnknownTableRowSecretProvenance(): TableRowSecretProvenanceWrite {
  return { complete: false, columns: {} }
}

/** Filters one execution registry to the exact value written into each touched cell. */
export function createTableRowSecretProvenanceFromRegistry(
  data: RowData,
  registry: ResolvedSecretTraceRegistry
): TableRowSecretProvenanceWrite {
  const columns: Record<string, ResolvedSecretTraceProvenanceV1> = {}
  for (const [columnId, value] of Object.entries(data)) {
    const provenance = registry.exportCommittedProvenanceForValue(value)
    if (!provenance.complete) return createUnknownTableRowSecretProvenance()
    columns[columnId] = provenance
  }
  return { complete: true, columns }
}

/**
 * Reconstructs trusted encrypted execution provenance, then narrows it to each
 * exact cell value. Missing, malformed, incomplete, or undecryptable envelopes
 * remain unknown; they are never reclassified as exact-empty.
 */
export async function createTableRowSecretProvenanceFromEncryptedExecution(
  data: RowData,
  provenance: unknown
): Promise<TableRowSecretProvenanceWrite> {
  if (!isResolvedSecretTraceProvenanceV1(provenance)) {
    return createUnknownTableRowSecretProvenance()
  }
  const registry = new ResolvedSecretTraceRegistry([], provenance.scope)
  if (
    !(await registry.importProvenance(provenance, {
      trusted: true,
      origin: 'tableRow.encryptedExecution',
    })) ||
    !registry.isComplete()
  ) {
    return createUnknownTableRowSecretProvenance()
  }
  return createTableRowSecretProvenanceFromRegistry(data, registry)
}

async function lockTableRows(trx: DbTransaction, rowIds: string[]): Promise<string[]> {
  const lockedRowIds: string[] = []
  const sortedRowIds = [...rowIds].sort(compareStrings)
  for (let index = 0; index < sortedRowIds.length; index += QUERY_CHUNK_SIZE) {
    const lockedRows = await trx
      .select({ id: userTableRows.id })
      .from(userTableRows)
      .where(inArray(userTableRows.id, sortedRowIds.slice(index, index + QUERY_CHUNK_SIZE)))
      .orderBy(asc(userTableRows.id))
      .for('update')
    lockedRowIds.push(...lockedRows.map((row) => row.id))
  }
  return lockedRowIds
}

const TABLE_ROW_SIDECAR_SELECTION = {
  id: userTableRows.id,
  updatedAt: userTableRows.updatedAt,
  secretProvenanceVersion: userTableRows.secretProvenanceVersion,
  sidecarStatus: userTableRowSecretProvenance.status,
  sidecarEntries: userTableRowSecretProvenance.entries,
  sidecarIsCurrent: sql<boolean>`COALESCE(${userTableRowSecretProvenance.contentUpdatedAt} = ${userTableRows.updatedAt}, false)`,
}

async function selectRowsWithSidecars(executor: DbExecutor, rowIds: string[]) {
  const rows = []
  for (let index = 0; index < rowIds.length; index += QUERY_CHUNK_SIZE) {
    rows.push(
      ...(await executor
        .select(TABLE_ROW_SIDECAR_SELECTION)
        .from(userTableRows)
        .leftJoin(
          userTableRowSecretProvenance,
          eq(userTableRowSecretProvenance.rowId, userTableRows.id)
        )
        .where(inArray(userTableRows.id, rowIds.slice(index, index + QUERY_CHUNK_SIZE))))
    )
  }
  return rows
}

/**
 * Locks existing rows before mutation, then binds field-scoped encrypted provenance
 * to the exact post-mutation row timestamp. New-row mutations skip the unnecessary
 * pre-insert read. Omitted provenance is the rolling-deploy compatibility path: the
 * trigger makes any old or unaware write stale, while provenance-aware writes replace
 * the stale state in this transaction.
 */
export async function mutateTableRowsWithSecretProvenance<T>(
  trx: DbTransaction,
  options: MutateTableRowsWithSecretProvenanceOptions<T>
): Promise<T> {
  const mutationsByRowId = new Map<string, TableRowProvenanceMutation>()
  for (const mutation of options.rows) {
    if (mutationsByRowId.has(mutation.rowId)) {
      throw new Error('Table row secret provenance contains a duplicate row')
    }
    mutationsByRowId.set(mutation.rowId, mutation)
  }
  const mutations = [...mutationsByRowId.values()]
  const rowIds = mutations.map((mutation) => mutation.rowId)
  const lockedRowIds =
    options.rowState === 'existing' && rowIds.length > 0 ? await lockTableRows(trx, rowIds) : []
  const existingRows =
    lockedRowIds.length > 0 ? await selectRowsWithSidecars(trx, lockedRowIds) : []
  const rowsById = new Map(existingRows.map((row) => [row.id, row]))
  const pendingByRowId = new Map<
    string,
    {
      row_id: string
      status: 'exact' | 'unknown'
      entries: StoredTableRowSecretProvenanceEntry[]
      cause?: UnvouchedTableRowWriteCause
    }
  >()

  for (const mutation of mutations) {
    if (mutation.provenance === undefined) continue
    const row = rowsById.get(mutation.rowId)
    const incoming = toStoredEntries(mutation.provenance)
    let status: 'exact' | 'unknown' = incoming.complete ? 'exact' : 'unknown'
    let entries = incoming.entries
    let cause: UnvouchedTableRowWriteCause | undefined = incoming.complete
      ? undefined
      : 'incoming-provenance-incomplete'

    if (options.mode === 'merge' && status === 'exact') {
      if (row?.secretProvenanceVersion === null) {
        entries = incoming.entries
      } else if (
        row?.secretProvenanceVersion === TABLE_ROW_SECRET_PROVENANCE_VERSION &&
        row.sidecarStatus === 'exact' &&
        row.sidecarIsCurrent
      ) {
        const existing = normalizeStoredEntries(row.sidecarEntries)
        if (existing) {
          const merged = normalizeStoredEntryBindings(
            mergedStoredEntries(existing, incoming.entries, incoming.touchedColumns)
          )
          if (merged) entries = merged
          else {
            status = 'unknown'
            cause = 'merge-result-unnormalizable'
          }
        } else {
          status = 'unknown'
          cause = 'merge-base-unnormalizable'
        }
      } else {
        status = 'unknown'
        cause = 'merge-base-unvouchable'
      }
    }
    pendingByRowId.set(mutation.rowId, {
      row_id: mutation.rowId,
      status,
      entries: status === 'exact' ? entries : [],
      ...(cause ? { cause } : {}),
    })
  }

  const outcome = await options.mutate()
  const affectedRowIds = new Set<string>()
  for (const rowId of outcome.affectedRowIds) {
    if (!mutationsByRowId.has(rowId)) {
      throw new Error('Table row mutation returned an undeclared row')
    }
    if (affectedRowIds.has(rowId)) {
      throw new Error('Table row mutation returned a duplicate row')
    }
    affectedRowIds.add(rowId)
  }

  const pending = [...pendingByRowId.values()].filter((row) => affectedRowIds.has(row.row_id))
  for (let index = 0; index < pending.length; index += QUERY_CHUNK_SIZE) {
    const chunk = JSON.stringify(pending.slice(index, index + QUERY_CHUNK_SIZE))
    const unrecordedWrites = await trx.execute<UnvouchedTableRowWriteReport>(sql`
      WITH pending AS (
        SELECT *
        FROM jsonb_to_recordset(${chunk}::jsonb)
          AS value(row_id text, status text, entries jsonb, cause text)
      ), bound AS (
        UPDATE ${userTableRows} AS target
        SET secret_provenance_version = ${TABLE_ROW_SECRET_PROVENANCE_VERSION}
        FROM pending
        WHERE target.id = pending.row_id
        RETURNING
          target.id AS row_id,
          target.updated_at AS content_updated_at,
          target.workspace_id,
          target.table_id
      ), persisted AS (
      INSERT INTO ${userTableRowSecretProvenance} (
        row_id,
        content_updated_at,
        status,
        entries,
        updated_at
      )
      SELECT
        bound.row_id,
        bound.content_updated_at,
        pending.status,
        pending.entries,
        now()
      FROM bound
      INNER JOIN pending ON pending.row_id = bound.row_id
      ON CONFLICT (row_id) DO UPDATE SET
        content_updated_at = EXCLUDED.content_updated_at,
        status = EXCLUDED.status,
        entries = EXCLUDED.entries,
        updated_at = EXCLUDED.updated_at
      RETURNING row_id, status
      )
      SELECT
        bound.workspace_id AS "workspaceId",
        bound.table_id AS "tableId",
        pending.cause,
        count(*)::integer AS "rowCount"
      FROM bound
      INNER JOIN pending ON pending.row_id = bound.row_id
      INNER JOIN persisted ON persisted.row_id = bound.row_id
      WHERE persisted.status = 'unknown'
      GROUP BY bound.workspace_id, bound.table_id, pending.cause
    `)
    for (const report of unrecordedWrites) reportUnvouchedTableRowWrite(report, options.mode)
  }

  return outcome.value
}

/**
 * Applies a trusted data transformation in bounded, keyset-paginated sets. Each page locks and
 * classifies the old payload, writes the matching sidecar, then restores the tracked marker only
 * after that sidecar exists in the same transaction.
 *
 * A cleared `secret_provenance_version` classifies as untracked whether or not a sidecar row
 * survives beside it. The demote trigger clears the marker and advances `updated_at`, so any
 * sidecar left behind is stale by construction and says nothing about the current payload —
 * exactly the row {@link loadTableRowSecretProvenance} and
 * {@link classifyTableRowSecretProvenanceForCopy} already read as legacy. Requiring the sidecar to
 * be absent made this the one classifier that called such a row unknown, which turned an ordinary
 * column operation into a bulk producer of durable unknowns.
 */
export async function updateTableRowsWithDerivedSecretProvenance(
  trx: DbTransaction,
  options: {
    rowWhere: SQL
    transformation: DerivedTableRowTransformation
  }
): Promise<number> {
  const removedColumnIds =
    options.transformation.mode === 'remove-columns'
      ? [...new Set(options.transformation.columnIds)]
      : []
  if (options.transformation.mode === 'remove-columns') {
    if (removedColumnIds.length === 0) return 0
    if (removedColumnIds.some((columnId) => columnId.length === 0)) {
      throw new Error('Derived table row transformation contains invalid columns')
    }
  }

  const removedColumnArray =
    removedColumnIds.length > 0 ? textArrayExpression(removedColumnIds) : undefined
  const rowWhere = removedColumnArray
    ? and(options.rowWhere, sql`${userTableRows.data} ?| ${removedColumnArray}`)!
    : options.rowWhere
  let dataExpression =
    options.transformation.mode === 'preserve'
      ? options.transformation.dataExpression
      : sql`${userTableRows.data}`
  for (const columnId of removedColumnIds) {
    dataExpression = sql`${dataExpression} - ${columnId}::text`
  }

  const exactEntries = removedColumnArray
    ? sql`COALESCE(
          (
            SELECT jsonb_agg(value.entry ORDER BY value.ordinality)
            FROM jsonb_array_elements(
              CASE
                WHEN jsonb_typeof(source.provenance_entries) = 'array'
                THEN source.provenance_entries
                ELSE '[]'::jsonb
              END
            )
              WITH ORDINALITY AS value(entry, ordinality)
            WHERE NOT ((value.entry ->> 'columnId') = ANY(${removedColumnArray}))
          ),
          '[]'::jsonb
        )`
    : sql`source.provenance_entries`

  let afterId: string | undefined
  let updatedCount = 0
  for (;;) {
    const page = await trx
      .select({ id: userTableRows.id })
      .from(userTableRows)
      .where(afterId ? and(rowWhere, gt(userTableRows.id, afterId)) : rowWhere)
      .orderBy(asc(userTableRows.id))
      .limit(QUERY_CHUNK_SIZE)
      .for('update')
    if (page.length === 0) break
    const rowIds = page.map((row) => row.id)
    updatedCount += rowIds.length

    const unrecordedWrites = await trx.execute<UnvouchedTableRowWriteReport>(sql`
      WITH source AS MATERIALIZED (
        SELECT
          ${userTableRows.id} AS row_id,
          ${userTableRows.workspaceId} AS workspace_id,
          ${userTableRows.tableId} AS table_id,
          ${userTableRows.updatedAt} AS old_updated_at,
          ${userTableRows.secretProvenanceVersion} AS old_provenance_version,
          ${userTableRowSecretProvenance.rowId} AS provenance_row_id,
          ${userTableRowSecretProvenance.contentUpdatedAt} AS provenance_content_updated_at,
          ${userTableRowSecretProvenance.status} AS provenance_status,
          ${userTableRowSecretProvenance.entries} AS provenance_entries
        FROM ${userTableRows}
        LEFT JOIN ${userTableRowSecretProvenance}
          ON ${userTableRowSecretProvenance.rowId} = ${userTableRows.id}
        WHERE ${inArray(userTableRows.id, rowIds)}
        ORDER BY ${userTableRows.id}
        FOR UPDATE OF ${userTableRows}
      ), updated AS (
        UPDATE ${userTableRows}
        SET data = ${dataExpression}
        FROM source
        WHERE ${userTableRows.id} = source.row_id
        RETURNING
          ${userTableRows.id} AS row_id,
          ${userTableRows.updatedAt} AS content_updated_at
      ), classified AS (
        SELECT
          updated.row_id,
          updated.content_updated_at,
          source.workspace_id,
          source.table_id,
          CASE
            WHEN (
              source.old_provenance_version = ${TABLE_ROW_SECRET_PROVENANCE_VERSION}
              AND source.provenance_status = 'exact'
              AND source.provenance_content_updated_at = source.old_updated_at
            ) IS TRUE
            THEN 'derived-base-unnormalizable'
            ELSE 'derived-base-unvouchable'
          END AS unrecorded_cause,
          CASE
            WHEN source.old_provenance_version IS NULL
            THEN '[]'::jsonb
            WHEN source.old_provenance_version = ${TABLE_ROW_SECRET_PROVENANCE_VERSION}
              AND source.provenance_status = 'exact'
              AND source.provenance_content_updated_at = source.old_updated_at
              AND jsonb_typeof(source.provenance_entries) = 'array'
              AND (
                SELECT count(DISTINCT value.entry ->> 'encryptedValue')
                FROM jsonb_array_elements(
                  CASE
                    WHEN jsonb_typeof(source.provenance_entries) = 'array'
                    THEN source.provenance_entries
                    ELSE '[]'::jsonb
                  END
                ) AS value(entry)
              ) <= ${PROVENANCE_MAX_ENTRIES}
              AND octet_length(source.provenance_entries::text) <= ${PROVENANCE_MAX_SERIALIZED_BYTES}
              AND NOT EXISTS (
                SELECT 1
                FROM jsonb_array_elements(
                  CASE
                    WHEN jsonb_typeof(source.provenance_entries) = 'array'
                    THEN source.provenance_entries
                    ELSE '[]'::jsonb
                  END
                ) AS value(entry)
                WHERE jsonb_typeof(value.entry) <> 'object'
                  OR EXISTS (
                    SELECT 1
                    FROM jsonb_object_keys(
                      CASE
                        WHEN jsonb_typeof(value.entry) = 'object'
                        THEN value.entry
                        ELSE '{}'::jsonb
                      END
                    ) AS key(name)
                    WHERE key.name NOT IN (
                      'columnId',
                      'encryptedValue',
                      'name',
                      'sourceUserId',
                      'sourceWorkspaceId'
                    )
                  )
                  OR jsonb_typeof(value.entry -> 'columnId') IS DISTINCT FROM 'string'
                  OR COALESCE(value.entry ->> 'columnId', '') = ''
                  OR jsonb_typeof(value.entry -> 'encryptedValue') IS DISTINCT FROM 'string'
                  OR COALESCE(value.entry ->> 'encryptedValue', '') = ''
                  OR (
                    value.entry ? 'name'
                    AND (
                      jsonb_typeof(value.entry -> 'name') IS DISTINCT FROM 'string'
                      OR COALESCE(value.entry ->> 'name', '') = ''
                    )
                  )
                  OR (
                    value.entry ? 'sourceUserId'
                    AND (
                      jsonb_typeof(value.entry -> 'sourceUserId') IS DISTINCT FROM 'string'
                      OR COALESCE(value.entry ->> 'sourceUserId', '') = ''
                    )
                  )
                  OR (
                    value.entry ? 'sourceWorkspaceId'
                    AND (
                      jsonb_typeof(value.entry -> 'sourceWorkspaceId') IS DISTINCT FROM 'string'
                      OR COALESCE(value.entry ->> 'sourceWorkspaceId', '') = ''
                    )
                  )
              )
            THEN ${exactEntries}
            ELSE NULL
          END AS exact_entries
        FROM updated
        INNER JOIN source ON source.row_id = updated.row_id
      ), persisted AS (
      INSERT INTO ${userTableRowSecretProvenance} (
        row_id,
        content_updated_at,
        status,
        entries,
        updated_at
      )
      SELECT
        classified.row_id,
        classified.content_updated_at,
        CASE WHEN classified.exact_entries IS NULL THEN 'unknown' ELSE 'exact' END,
        COALESCE(classified.exact_entries, '[]'::jsonb),
        now()
      FROM classified
      ON CONFLICT (row_id) DO UPDATE SET
        content_updated_at = EXCLUDED.content_updated_at,
        status = EXCLUDED.status,
        entries = EXCLUDED.entries,
        updated_at = EXCLUDED.updated_at
      RETURNING row_id, status
      )
      SELECT
        classified.workspace_id AS "workspaceId",
        classified.table_id AS "tableId",
        classified.unrecorded_cause AS cause,
        count(*)::integer AS "rowCount"
      FROM classified
      INNER JOIN persisted ON persisted.row_id = classified.row_id
      WHERE persisted.status = 'unknown'
      GROUP BY classified.workspace_id, classified.table_id, classified.unrecorded_cause
    `)

    await trx.execute(sql`
      UPDATE ${userTableRows} AS target
      SET secret_provenance_version = ${TABLE_ROW_SECRET_PROVENANCE_VERSION}
      FROM ${userTableRowSecretProvenance} AS provenance
      WHERE target.id = provenance.row_id
        AND ${inArray(sql`target.id`, rowIds)}
        AND provenance.content_updated_at = target.updated_at
    `)

    for (const report of unrecordedWrites) {
      reportUnvouchedTableRowWrite(report, options.transformation.mode)
    }

    afterId = rowIds[rowIds.length - 1]
    if (page.length < QUERY_CHUNK_SIZE) break
  }
  return updatedCount
}

async function readTableRowsVersion(tableId: string, workspaceId: string): Promise<number | null> {
  const [table] = await db
    .select({ rowsVersion: userTableDefinitions.rowsVersion })
    .from(userTableDefinitions)
    .where(
      and(eq(userTableDefinitions.id, tableId), eq(userTableDefinitions.workspaceId, workspaceId))
    )
    .limit(1)
  return table?.rowsVersion ?? null
}

export type TableSnapshotModelMountSafety = 'safe' | 'unsafe-provenance' | 'stale'

/**
 * Classifies whether a version-pinned table snapshot can cross into a model-controlled sandbox.
 * A version change takes precedence over provenance because stale bytes must never be mounted.
 */
export async function getTableSnapshotModelMountSafety(options: {
  tableId: string
  workspaceId: string
  rowsVersion: number
}): Promise<TableSnapshotModelMountSafety> {
  if ((await readTableRowsVersion(options.tableId, options.workspaceId)) !== options.rowsVersion) {
    return 'stale'
  }

  /**
   * A missing LEFT JOIN sidecar is an explicit absence, not SQL NULL in a negated safety
   * predicate. Legacy and unrecorded rows follow the same policy as ordinary table reads;
   * a current exact sidecar containing secrets cannot accompany an unredacted CSV mount.
   */
  const classification = sql`CASE
    WHEN ${userTableRows.secretProvenanceVersion} IS NULL THEN 'safe'
    WHEN (
      ${userTableRows.secretProvenanceVersion} = ${TABLE_ROW_SECRET_PROVENANCE_VERSION}
      AND ${userTableRowSecretProvenance.status} = 'exact'
      AND ${userTableRowSecretProvenance.contentUpdatedAt} = ${userTableRows.updatedAt}
    ) IS NOT TRUE THEN 'unrecorded'
    WHEN ${userTableRowSecretProvenance.entries} = '[]'::jsonb THEN 'safe'
    ELSE 'unsafe'
  END`
  const [counts] = await db
    .select({
      unsafeCount: sql<number | string>`count(*) FILTER (WHERE (${classification}) = 'unsafe')`,
      unrecordedCount: sql<
        number | string
      >`count(*) FILTER (WHERE (${classification}) = 'unrecorded')`,
    })
    .from(userTableRows)
    .leftJoin(
      userTableRowSecretProvenance,
      eq(userTableRowSecretProvenance.rowId, userTableRows.id)
    )
    .where(
      and(
        eq(userTableRows.tableId, options.tableId),
        eq(userTableRows.workspaceId, options.workspaceId)
      )
    )

  if ((await readTableRowsVersion(options.tableId, options.workspaceId)) !== options.rowsVersion) {
    return 'stale'
  }

  if (!counts || Number(counts.unsafeCount) > 0) return 'unsafe-provenance'
  const unrecordedCount = Number(counts.unrecordedCount)
  if (unrecordedCount > 0) {
    if (isDurableSecretProvenanceEnforced('table-row')) return 'unsafe-provenance'
    reportUnrecordedDurableProvenance({
      surface: 'table-row',
      cause: 'row-sidecar-not-exact',
      affectedCount: unrecordedCount,
      workspaceId: options.workspaceId,
    })
  }
  return 'safe'
}

/**
 * Folds crossing entries into the distinct secrets the response actually carries.
 *
 * A response holds one entry per distinct `encryptedValue`, so its size is the workspace's secret
 * catalog, not the page's cells. Collecting every cell's entry first and capping that count made a
 * page refuse to vouch for a response it could have built — a page of 1,000 rows carrying 11
 * distinct secrets each is 11,000 collected entries but only 11 reported ones. Folding as rows
 * arrive means only the reported set is ever held, and only it is bounded.
 */
function createStoredEntryAggregator(scope: ResolvedSecretTraceScopeV1) {
  const byEncryptedValue = new Map<
    string,
    { names: Set<string>; hasForeignOrAnonymousSource: boolean }
  >()
  return {
    /** False once the distinct secrets outgrow what one response may carry. */
    add(entry: StoredTableRowSecretProvenanceEntry): boolean {
      let aggregate = byEncryptedValue.get(entry.encryptedValue)
      if (!aggregate) {
        if (byEncryptedValue.size >= PROVENANCE_MAX_ENTRIES) return false
        aggregate = { names: new Set<string>(), hasForeignOrAnonymousSource: false }
        byEncryptedValue.set(entry.encryptedValue, aggregate)
      }
      const sameScope =
        entry.sourceUserId === scope.userId && entry.sourceWorkspaceId === scope.workspaceId
      if (sameScope && entry.name) aggregate.names.add(entry.name)
      else aggregate.hasForeignOrAnonymousSource = true
      return true
    },
    build(): ResolvedSecretTraceProvenanceEntryV1[] | undefined {
      const result = [...byEncryptedValue.entries()]
        .sort(([left], [right]) => compareStrings(left, right))
        .map(([encryptedValue, aggregate]) => ({
          encryptedValue,
          ...(!aggregate.hasForeignOrAnonymousSource && aggregate.names.size === 1
            ? { name: [...aggregate.names][0] }
            : {}),
        }))
      return serializedBytes(result) <= PROVENANCE_MAX_SERIALIZED_BYTES ? result : undefined
    },
  }
}

/**
 * Builds one bounded provenance envelope for rows crossing an authenticated
 * internal table boundary. Untracked legacy rows contribute an exact-empty
 * report; tracked missing, stale, or malformed sidecars make the report
 * incomplete without inspecting configured secret plaintext.
 */
export async function loadTableRowSecretProvenance(
  rows: TableRowCrossing[],
  scope: ResolvedSecretTraceScopeV1
): Promise<ResolvedSecretTraceProvenanceV1> {
  if (rows.length === 0) {
    return { version: 1, complete: true, entries: [], scope }
  }

  const crossingById = new Map<string, TableRowCrossing & { selectedColumnIds?: Set<string> }>()
  for (const row of rows) {
    const existing = crossingById.get(row.id)
    if (existing && !sameTimestamp(existing.updatedAt, row.updatedAt)) {
      return { version: 1, complete: false, entries: [], scope }
    }
    const selectedColumnIds = row.selectedValues
      ? new Set(Object.keys(row.selectedValues))
      : undefined
    if (!existing) {
      crossingById.set(row.id, { ...row, selectedColumnIds })
      continue
    }
    if (!existing.selectedColumnIds || !selectedColumnIds) {
      existing.selectedColumnIds = undefined
      continue
    }
    for (const columnId of selectedColumnIds) existing.selectedColumnIds.add(columnId)
  }
  const rowIds = [...crossingById.keys()]
  const currentRows = await selectRowsWithSidecars(db, rowIds)
  const currentById = new Map(currentRows.map((row) => [row.id, row]))
  const aggregator = createStoredEntryAggregator(scope)

  let unrecordedRowCount = 0
  for (const rowId of rowIds) {
    const current = currentById.get(rowId)
    const crossing = crossingById.get(rowId)
    if (!current || !crossing || !sameTimestamp(current.updatedAt, crossing.updatedAt)) {
      return { version: 1, complete: false, entries: [], scope }
    }
    if (current.secretProvenanceVersion === null) continue
    if (
      current.secretProvenanceVersion !== TABLE_ROW_SECRET_PROVENANCE_VERSION ||
      current.sidecarStatus !== 'exact' ||
      !current.sidecarIsCurrent
    ) {
      /**
       * One such row would otherwise void the whole page, and a page is what a `query_rows` block
       * hands downstream — so a single row nobody recorded provenance for latched every run that
       * read the table. Unenforced, the row contributes nothing, exactly like the legacy row above.
       */
      if (isDurableSecretProvenanceEnforced('table-row')) {
        return { version: 1, complete: false, entries: [], scope }
      }
      unrecordedRowCount += 1
      continue
    }
    const parsed = normalizeStoredEntries(current.sidecarEntries)
    if (!parsed) return { version: 1, complete: false, entries: [], scope }
    for (const entry of parsed) {
      if (crossing.selectedColumnIds && !crossing.selectedColumnIds.has(entry.columnId)) continue
      if (!aggregator.add(entry)) return { version: 1, complete: false, entries: [], scope }
    }
  }

  if (unrecordedRowCount > 0) {
    reportUnrecordedDurableProvenance({
      surface: 'table-row',
      cause: 'row-sidecar-not-exact',
      affectedCount: unrecordedRowCount,
      ...(scope.workspaceId ? { workspaceId: scope.workspaceId } : {}),
      actorUserId: scope.userId,
    })
  }

  const entries = aggregator.build()
  if (!entries) return { version: 1, complete: false, entries: [], scope }
  const provenance: ResolvedSecretTraceProvenanceV1 = {
    version: 1,
    complete: true,
    entries,
    scope,
  }
  return isResolvedSecretTraceProvenanceV1(provenance)
    ? provenance
    : { version: 1, complete: false, entries: [], scope }
}
