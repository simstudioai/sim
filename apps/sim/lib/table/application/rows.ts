import { isDeepStrictEqual } from 'node:util'
import { AuditAction, AuditResourceType } from '@sim/audit'
import { type Principal, resolvePrincipalAttribution } from '@sim/auth/principal'
import { db } from '@sim/db'
import { getRequestContext } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { isPlainRecord } from '@sim/utils/object'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { isPrivateSecretProvenanceScopeCompatible } from '@/lib/execution/durable-secret-provenance'
import type {
  BulkDeleteByIdsResult,
  BulkOperationResult,
  Filter,
  ReplaceRowsResult,
  RowData,
  RowExecutions,
  Sort,
  SortSpec,
  TableDefinition,
  TablePredicate,
  TableRow,
  TableRowSecretProvenanceWrite,
} from '@/lib/table'
import {
  batchInsertRows,
  batchUpdateRows,
  deleteRow,
  deleteRowsByFilter,
  deleteRowsByIds,
  findRowMatches,
  getRowSummaryById,
  insertRow,
  queryRows,
  replaceTableRows as replaceTableRowsPrimitive,
  rowDataNameToId,
  sortSpecNamesToIds,
  TABLE_LIMITS,
  type TableRowSummary,
  updateRow,
  updateRowsByFilter,
  upsertRow,
  validateBatchRows,
  validateRowData,
  withLockedTable,
} from '@/lib/table'
import { defineAuthorizedTableUseCase } from '@/lib/table/application/authorized-table-use-case'
import { resolveActiveTableContext } from '@/lib/table/application/context'
import { tableOperations } from '@/lib/table/application/operations'
import {
  resolveRowWriteProvenance,
  type TableRowProvenanceEnvelope,
} from '@/lib/table/application/row-secret-provenance'
import { assertRowCapacity, notifyTableRowUsage } from '@/lib/table/billing'
import { buildColumnNameById, buildIdByName, unknownColumnNames } from '@/lib/table/column-keys'
import { columnTypeOf } from '@/lib/table/column-types'
import { TableQueryValidationError } from '@/lib/table/errors'
import { signalTableRowsChanged, signalTableRowsChangedByActor } from '@/lib/table/events'
import { CSV_MAX_BATCH_SIZE } from '@/lib/table/import'
import { predicateToFilter } from '@/lib/table/query-builder/converters'
import {
  validatePredicate,
  validatePredicateShape,
  validateSortSpec,
  validateStoragePredicate,
} from '@/lib/table/query-builder/validate'
import { assertCursorQueryBinding, decodeCursor } from '@/lib/table/rows/cursor'
import { loadEnrichmentDetail, loadExecutionsForRow } from '@/lib/table/rows/executions'
import {
  createExactEmptyTableRowSecretProvenance,
  createTableRowSecretProvenanceFromRegistry,
  createUnknownTableRowSecretProvenance,
  loadTableRowSecretProvenance,
} from '@/lib/table/rows/secret-provenance'
import type { FindRowMatch, RowWriteOptions } from '@/lib/table/rows/service'
import { replaceTableRowsWithTx } from '@/lib/table/rows/service'
import { predicateToStorage } from '@/lib/table/select-values'
import { coerceRowValues } from '@/lib/table/validation'
import type { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

export class TableRowsValidationError extends OrchestrationError {
  constructor(
    message: string,
    readonly details?: unknown
  ) {
    super('validation', message)
    this.name = 'TableRowsValidationError'
  }
}

interface TableScopedInput {
  tableId: string
  assertedWorkspaceId?: string
  requestId?: string
}

/**
 * Opt-in on every read that returns whole rows.
 *
 * The projection stays byte-identical by default: the sidecar is a second query
 * and its `blockErrors` are unbounded, so a shipped caller must never start
 * paying for it. When a caller does opt in, the sidecar drain accumulates its
 * own byte budget and refuses past `TABLE_LIMITS.MAX_ROW_RUN_STATE_BYTES` — the
 * ceiling is spent inside the read rather than measured after it, so an
 * over-budget page never gets materialized in the first place.
 */
interface RunStateReadInput {
  includeRunState?: boolean
}

/**
 * The write policy `strictWrite` selects, for the row-service primitives.
 *
 * `strictWrite` means the calling surface publishes the stricter `/api/v2` write
 * contract: a row naming a column the table does not have is refused rather than
 * having that key dropped, and a value the column's type cannot coerce is
 * answered with a 400 rather than stored as `null`.
 *
 * Absent — every first-party surface, and the only behavior any of them has ever
 * had: the workspace grid, the internal `/api/table` routes, `/api/v1`, the
 * Copilot table tools, and the executor's Table block all drop the unknown key
 * and blank the uncoercible cell.
 */
function rowWriteOptions(input: { strictWrite: boolean }): RowWriteOptions {
  return input.strictWrite ? { uncoercibleValues: 'reject' } : {}
}

interface TableResult {
  table: TableDefinition
}

type TableRowsProvenance = Awaited<ReturnType<typeof loadTableRowSecretProvenance>>

async function loadAuthorizedRowsProvenance(
  workspaceId: string,
  attributedUserId: string,
  // The loader reads only id, updatedAt and the selected values, so a row
  // without its executions sidecar is enough — see `TABLE_ROW_SIDECAR_SELECTION`.
  rows: TableRowSummary[],
  include: boolean | undefined
): Promise<TableRowsProvenance | undefined> {
  if (!include) return undefined
  return loadTableRowSecretProvenance(
    // `selectedValues` narrows the sidecar to the columns the row still holds.
    // Without it a stale entry for a dropped column rides along in the envelope,
    // which is how the unmigrated `rows`/`query` routes have always behaved.
    rows.map((row) => ({ id: row.id, updatedAt: row.updatedAt, selectedValues: row.data })),
    {
      userId: attributedUserId,
      workspaceId,
    }
  )
}

function requestId(input: TableScopedInput): string {
  return input.requestId ?? getRequestContext()?.requestId ?? generateId().slice(0, 8)
}

function actorUserId(
  principal: Parameters<typeof resolvePrincipalAttribution>[0],
  billedAccountUserId: string
): string {
  return resolvePrincipalAttribution(principal, {
    workspaceBillingOwnerUserId: billedAccountUserId,
  }).attributedUserId
}

/**
 * Refuses a wire row naming a column the table does not have. Applied only to a
 * `strictWrite` caller — see {@link rowWriteOptions}.
 *
 * The name→id remap drops unrecognised keys, so without this an insert of
 * `{"nosuchcol":"x"}` created an empty row under a 201, and a patch of
 * `{"zzz":"x"}` answered `updatedCount: 0` — indistinguishable from a predicate
 * that matched nothing, and in both cases the client is told the write
 * succeeded. Naming the offending columns is the only answer that lets a caller
 * tell a typo apart from an empty match.
 */
function assertKnownColumnNames(
  data: RowData,
  idByName: ReadonlyMap<string, string>,
  rowLabel?: string
): void {
  assertNoUnknownColumns(unknownColumnNames(data, idByName), rowLabel)
}

/**
 * Refuses a wire row naming a column the table does not have, on either wire.
 * Shared so the two keyings cannot drift in how they name the offending keys.
 */
function assertNoUnknownColumns(unknown: string[], rowLabel?: string): void {
  if (unknown.length === 0) return
  const where = rowLabel ? `${rowLabel}: ` : ''
  throw new TableRowsValidationError(
    `${where}Unknown column${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}`
  )
}

/**
 * Which column keying a write's row data arrives in.
 *
 * `'names'` — the caller publishes column **names** on its wire: `/api/v2`,
 * `/api/v1`, and the Copilot table tools, where a name is what the caller (or
 * the model) can read off a row. Names are remapped to storage ids here.
 *
 * `'ids'` — the caller already speaks stable storage column **ids**: the
 * first-party grid and the internal `/api/table` routes, which hold the schema
 * they rendered and address cells by id.
 *
 * Required so a new write surface must state which contract it publishes. The
 * name remap drops keys it does not recognise, and a storage id names no column
 * *name*, so feeding id-keyed data through the name path silently drops every
 * cell and reports the write as successful.
 *
 * Row data needs this and filters, sorts and predicates do not: their
 * translators pass an unrecognised field through unchanged (`idByName.get(key)
 * ?? key`), so they are already correct under either keying. Only the row-data
 * remap is lossy, which is why only it carries a discriminator.
 */
export type TableRowDataKeying = 'names' | 'ids'

/**
 * The id-keyed counterpart of {@link assertKnownColumnNames}, applied on the same
 * `strictWrite` condition so strictness means the same thing on either wire.
 *
 * `buildColumnNameById` keys by {@link getColumnId}, so a legacy pre-backfill
 * column — which has no id and is stored under its name — is recognised rather
 * than reported unknown.
 */
function assertKnownColumnIds(data: RowData, table: TableDefinition, rowLabel?: string): void {
  assertNoUnknownColumns(
    unknownColumnNames(data, buildColumnNameById(table.schema.columns)),
    rowLabel
  )
}

/**
 * Normalizes one wire row to storage keying. See {@link TableRowDataKeying}.
 *
 * Note the asymmetry a lax (non-`strictWrite`) caller sees: the name path drops
 * keys naming no column, while the id path stores what it is given. That
 * matches what each wire did before this discriminator existed, and only
 * `strictWrite` makes the two agree.
 */
function rowDataToStorage(
  data: RowData,
  table: TableDefinition,
  keying: TableRowDataKeying,
  strict = false
): RowData {
  if (keying === 'ids') {
    if (strict) assertKnownColumnIds(data, table)
    return data
  }
  const idByName = buildIdByName(table.schema)
  if (strict) assertKnownColumnNames(data, idByName)
  return rowDataNameToId(data, idByName)
}

/**
 * {@link rowDataToStorage} over a batch. Either index is built once for the
 * whole batch rather than per row — these paths run over up to
 * `MAX_BATCH_INSERT_SIZE` rows.
 */
function rowsToStorage(
  rows: readonly RowData[],
  table: TableDefinition,
  keying: TableRowDataKeying,
  strict = false
): RowData[] {
  if (keying === 'ids') {
    if (!strict) return [...rows]
    const nameById = buildColumnNameById(table.schema.columns)
    return rows.map((row, index) => {
      assertNoUnknownColumns(unknownColumnNames(row, nameById), `Row ${index + 1}`)
      return row
    })
  }
  const idByName = buildIdByName(table.schema)
  return rows.map((row, index) => {
    if (strict) assertKnownColumnNames(row, idByName, `Row ${index + 1}`)
    return rowDataNameToId(row, idByName)
  })
}

/**
 * Every row write must stamp a provenance sidecar, otherwise the next read
 * reports the whole page incomplete. A caller that resolves no provenance of its
 * own is an interactive (non-runtime) write, which certifies as exact-empty over
 * the storage columns it actually persists — the same stamp the internal row
 * routes resolve for an unauthenticated-envelope write.
 */
function defaultedRowSecretProvenance(
  storageData: RowData,
  provided: TableRowSecretProvenanceWrite | undefined
): TableRowSecretProvenanceWrite {
  return provided ?? createExactEmptyTableRowSecretProvenance(storageData)
}

/**
 * The stamp a single-row write should carry: resolved from the caller's envelope
 * when it handed one over, otherwise defaulted. Shared by the update and upsert
 * use cases so the envelope contract has one implementation, not two.
 */
function singleRowWriteProvenance(options: {
  principal: Principal
  workspaceId: string
  table: TableDefinition
  input: {
    dataKeying: TableRowDataKeying
    data: RowData
    secretProvenance?: TableRowSecretProvenanceWrite
    secretProvenanceEnvelope?: TableRowProvenanceEnvelope
  }
  storageData: RowData
}): TableRowSecretProvenanceWrite | undefined {
  const { principal, workspaceId, table, input, storageData } = options
  if (!input.secretProvenanceEnvelope) {
    return defaultedRowSecretProvenance(storageData, input.secretProvenance)
  }
  return resolveRowWriteProvenance({
    envelope: input.secretProvenanceEnvelope,
    principal,
    workspaceId,
    table,
    keying: input.dataKeying,
    wireRows: [input.data],
    storageRows: [storageData],
  }).stamps[0]
}

function defaultedRowsSecretProvenance(
  storageRows: RowData[],
  provided: Array<TableRowSecretProvenanceWrite | undefined> | undefined
): TableRowSecretProvenanceWrite[] {
  return storageRows.map((row, index) => defaultedRowSecretProvenance(row, provided?.[index]))
}

function requireIntegerInRange(value: number, min: number, max: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new TableRowsValidationError(`${label} must be between ${min} and ${max}`)
  }
}

export function tablePredicateNamesToFilter(
  predicate: TablePredicate,
  table: TableDefinition
): Filter {
  try {
    validatePredicateShape(predicate)
    const translated = predicateToStorage(predicate, table.schema)
    validateStoragePredicate(translated, table.schema.columns)
    return predicateToFilter(translated)
  } catch (error) {
    rethrowQueryValidation(error)
  }
}

async function throwValidationResponse(
  validation:
    | { valid: true }
    | { valid: false; response: { clone(): { json(): Promise<unknown> } } }
): Promise<void> {
  if (validation.valid) return
  const body = (await validation.response.clone().json()) as {
    error?: string
    details?: unknown
  }
  throw new TableRowsValidationError(body.error ?? 'Invalid row data', body.details)
}

function rethrowQueryValidation(error: unknown): never {
  if (error instanceof TableQueryValidationError) {
    throw new TableRowsValidationError(error.message, error.code ? { code: error.code } : undefined)
  }
  throw error
}

export interface ListTableRowsInput extends TableScopedInput, RunStateReadInput {
  limit: number
  cursor?: string
}

export interface ListTableRowsResult extends TableResult {
  rows: TableRow[]
  nextCursor: string | null
}

export const listTableRows = defineAuthorizedTableUseCase({
  operation: tableOperations.listRows,
  resolveContext: ({ input }: { input: ListTableRowsInput }) => resolveActiveTableContext(input),
  async execute({ input, context }): Promise<ListTableRowsResult> {
    requireIntegerInRange(input.limit, 1, TABLE_LIMITS.MAX_QUERY_LIMIT, 'Limit')
    try {
      const cursor = input.cursor ? decodeCursor(input.cursor) : undefined
      if (cursor) assertCursorQueryBinding(cursor, {})
      const result = await queryRows(
        context.table,
        {
          limit: input.limit,
          after: cursor?.after,
          offset: cursor?.offset,
          includeTotal: false,
          withExecutions: input.includeRunState ?? false,
          runStateBudgetBytes: TABLE_LIMITS.MAX_ROW_RUN_STATE_BYTES,
        },
        requestId(input)
      )
      return {
        table: context.table,
        rows: result.rows,
        nextCursor: result.nextCursor,
      }
    } catch (error) {
      rethrowQueryValidation(error)
    }
  },
})

export interface QueryTableRowsInput extends TableScopedInput, RunStateReadInput {
  predicate?: TablePredicate
  sort?: SortSpec
  limit?: number
  cursor?: string
  includeTotal?: boolean
  includePersistedSecretProvenance?: boolean
}

export interface QueryTableRowsResult extends TableResult {
  rows: TableRow[]
  rowCount: number
  totalCount: number | null
  nextCursor: string | null
  secretProvenance?: TableRowsProvenance
}

export const queryTableRows = defineAuthorizedTableUseCase({
  operation: tableOperations.queryRows,
  resolveContext: ({ input }: { input: QueryTableRowsInput }) => resolveActiveTableContext(input),
  async execute({ principal, input, context }): Promise<QueryTableRowsResult> {
    try {
      if (input.limit !== undefined) {
        requireIntegerInRange(input.limit, 1, TABLE_LIMITS.MAX_QUERY_LIMIT, 'Limit')
      }
      let predicate = input.predicate
      if (predicate) {
        validatePredicate(predicate, context.table.schema.columns)
        predicate = predicateToStorage(predicate, context.table.schema)
      }
      let sortSpec = input.sort
      if (sortSpec?.length) {
        validateSortSpec(sortSpec, context.table.schema.columns)
        sortSpec = sortSpecNamesToIds(sortSpec, buildIdByName(context.table.schema))
      }
      const sort: Sort | undefined = sortSpec?.length
        ? Object.fromEntries(sortSpec.map((item) => [item.field, item.direction]))
        : undefined
      const cursor = input.cursor ? decodeCursor(input.cursor) : undefined
      if (cursor) assertCursorQueryBinding(cursor, { sort, predicate })
      const result = await queryRows(
        context.table,
        {
          predicate,
          sort,
          limit: input.limit,
          after: cursor?.after,
          offset: cursor?.offset,
          includeTotal: input.includeTotal ?? false,
          withExecutions: input.includeRunState ?? false,
          runStateBudgetBytes: TABLE_LIMITS.MAX_ROW_RUN_STATE_BYTES,
        },
        requestId(input)
      )
      return {
        table: context.table,
        ...result,
        secretProvenance: await loadAuthorizedRowsProvenance(
          context.workspaceId,
          actorUserId(principal, context.billedAccountUserId),
          result.rows,
          input.includePersistedSecretProvenance
        ),
      }
    } catch (error) {
      rethrowQueryValidation(error)
    }
  },
})

export interface SearchTableRowsInput extends TableScopedInput {
  q: string
  predicate?: TablePredicate
  sort?: SortSpec
}

export interface SearchTableRowsResult extends TableResult {
  matches: FindRowMatch[]
  truncated: boolean
}

export const searchTableRows = defineAuthorizedTableUseCase({
  operation: tableOperations.searchRows,
  resolveContext: ({ input }: { input: SearchTableRowsInput }) => resolveActiveTableContext(input),
  async execute({ input, context }): Promise<SearchTableRowsResult> {
    try {
      if (input.q.length === 0) {
        throw new TableRowsValidationError('q must be a non-empty search string')
      }
      const filter = input.predicate
        ? tablePredicateNamesToFilter(input.predicate, context.table)
        : undefined
      let sort: Sort | undefined
      if (input.sort?.length) {
        validateSortSpec(input.sort, context.table.schema.columns)
        const translated = sortSpecNamesToIds(input.sort, buildIdByName(context.table.schema))
        sort = Object.fromEntries(translated.map((item) => [item.field, item.direction]))
      }
      const result = await findRowMatches(
        context.table,
        { q: input.q, filter, sort },
        requestId(input)
      )
      return { table: context.table, ...result }
    } catch (error) {
      rethrowQueryValidation(error)
    }
  },
})

export interface ReadTableRowInput extends TableScopedInput, RunStateReadInput {
  rowId: string
  includePersistedSecretProvenance?: boolean
}

export interface ReadTableRowResult extends TableResult {
  /** The stored row without its sidecars; run state travels separately below. */
  row: TableRowSummary
  /** Per-group run state, present only when the read asked for it. */
  runState?: RowExecutions
  secretProvenance?: TableRowsProvenance
}

export const readTableRow = defineAuthorizedTableUseCase({
  operation: tableOperations.readRow,
  resolveContext: ({ input }: { input: ReadTableRowInput }) => resolveActiveTableContext(input),
  async execute({ principal, input, context }): Promise<ReadTableRowResult> {
    const row = await getRowSummaryById(context.tableId, input.rowId, context.workspaceId)
    if (!row) throw new OrchestrationError('not_found', 'Row not found')
    const runState = input.includeRunState
      ? await loadExecutionsForRow(db, input.rowId, {
          budgetBytes: TABLE_LIMITS.MAX_ROW_RUN_STATE_BYTES,
        })
      : undefined
    return {
      table: context.table,
      row,
      ...(runState ? { runState } : {}),
      secretProvenance: await loadAuthorizedRowsProvenance(
        context.workspaceId,
        actorUserId(principal, context.billedAccountUserId),
        [row],
        input.includePersistedSecretProvenance
      ),
    }
  },
})

export interface ReadTableRowEnrichmentInput extends TableScopedInput {
  rowId: string
  groupId: string
}

export interface ReadTableRowEnrichmentResult extends TableResult {
  detail: Awaited<ReturnType<typeof loadEnrichmentDetail>>
}

/**
 * The enrichment cascade breakdown — provider outcomes, cost, timing — for one
 * cell. Deliberately kept off the hot grid read and fetched on demand by the
 * details panel; `null` for a cell with no recorded run, or a run predating the
 * feature. The row id and group id are validated first so an unknown id 404s
 * instead of being indistinguishable from "no enrichment run yet".
 *
 * Shares {@link tableOperations.readRow}: this is a projection of the same row,
 * under the same role, so it is not a second semantic operation.
 */
export const readTableRowEnrichmentDetail = defineAuthorizedTableUseCase({
  operation: tableOperations.readRow,
  resolveContext: ({ input }: { input: ReadTableRowEnrichmentInput }) =>
    resolveActiveTableContext(input),
  async execute({ input, context }): Promise<ReadTableRowEnrichmentResult> {
    const rowExists = await getRowSummaryById(context.tableId, input.rowId, context.workspaceId)
    if (!rowExists) throw new OrchestrationError('not_found', 'Row not found')
    const groupExists = (context.table.schema.workflowGroups ?? []).some(
      (group) => group.id === input.groupId
    )
    if (!groupExists) {
      throw new OrchestrationError('not_found', 'Workflow group not found')
    }
    return {
      table: context.table,
      detail: await loadEnrichmentDetail(db, context.tableId, input.rowId, input.groupId),
    }
  },
})

interface CreateSingleTableRowInput extends TableScopedInput {
  /** See {@link rowWriteOptions}. Required so a new write surface must choose. */
  strictWrite: boolean
  /** See {@link TableRowDataKeying}. Required so a new write surface must choose. */
  dataKeying: TableRowDataKeying
  kind: 'single'
  /** See {@link UpdateTableRowInput.actorClientId}. */
  actorClientId?: string
  data: RowData
  position?: number
  afterRowId?: string
  beforeRowId?: string
  secretProvenance?: TableRowSecretProvenanceWrite
}

interface CreateBatchTableRowsInput extends TableScopedInput {
  /** See {@link rowWriteOptions}. Required so a new write surface must choose. */
  strictWrite: boolean
  /** See {@link TableRowDataKeying}. Required so a new write surface must choose. */
  dataKeying: TableRowDataKeying
  kind: 'batch'
  rows: RowData[]
  orderKeys?: string[]
  secretProvenance?: Array<TableRowSecretProvenanceWrite | undefined>
}

export type CreateTableRowsInput = CreateSingleTableRowInput | CreateBatchTableRowsInput

export type CreateTableRowsResult =
  | (TableResult & { kind: 'single'; row: TableRow })
  | (TableResult & { kind: 'batch'; rows: TableRow[] })

export const createTableRows = defineAuthorizedTableUseCase({
  operation: tableOperations.createRows,
  resolveContext: ({ input }: { input: CreateTableRowsInput }) => resolveActiveTableContext(input),
  async execute({ principal, input, context }): Promise<CreateTableRowsResult> {
    const userId = actorUserId(principal, context.billedAccountUserId)
    if (input.kind === 'single') {
      if (input.afterRowId && input.beforeRowId) {
        throw new TableRowsValidationError('afterRowId and beforeRowId are mutually exclusive')
      }
      if (
        input.position !== undefined &&
        (!Number.isSafeInteger(input.position) || input.position < 0)
      ) {
        throw new TableRowsValidationError('Position must be 0 or greater')
      }
      const data = rowDataToStorage(input.data, context.table, input.dataKeying, input.strictWrite)
      const writeOptions = rowWriteOptions(input)
      await throwValidationResponse(
        await validateRowData({
          rowData: data,
          schema: context.table.schema,
          tableId: context.tableId,
          uncoercibleValues: writeOptions.uncoercibleValues,
        })
      )
      const row = await insertRow(
        {
          tableId: context.tableId,
          workspaceId: context.workspaceId,
          data,
          userId,
          position: input.position,
          afterRowId: input.afterRowId,
          beforeRowId: input.beforeRowId,
          secretProvenance: defaultedRowSecretProvenance(data, input.secretProvenance),
        },
        context.table,
        requestId(input),
        writeOptions
      )
      return { kind: 'single', table: context.table, row }
    }
    if (input.rows.length < 1 || input.rows.length > TABLE_LIMITS.MAX_BATCH_INSERT_SIZE) {
      throw new TableRowsValidationError(
        `Batch row count must be between 1 and ${TABLE_LIMITS.MAX_BATCH_INSERT_SIZE}`
      )
    }
    if (input.secretProvenance && input.secretProvenance.length !== input.rows.length) {
      throw new TableRowsValidationError('Secret provenance must align one-to-one with rows')
    }
    if (input.orderKeys && input.orderKeys.length !== input.rows.length) {
      throw new TableRowsValidationError('orderKeys must align one-to-one with rows')
    }
    const rows = rowsToStorage(input.rows, context.table, input.dataKeying, input.strictWrite)
    const batchWriteOptions = rowWriteOptions(input)
    await throwValidationResponse(
      await validateBatchRows({
        rows,
        schema: context.table.schema,
        tableId: context.tableId,
        uncoercibleValues: batchWriteOptions.uncoercibleValues,
      })
    )
    const created = await batchInsertRows(
      {
        tableId: context.tableId,
        workspaceId: context.workspaceId,
        rows,
        userId,
        orderKeys: input.orderKeys,
        secretProvenance: defaultedRowsSecretProvenance(rows, input.secretProvenance),
      },
      context.table,
      requestId(input),
      batchWriteOptions
    )
    return { kind: 'batch', table: context.table, rows: created }
  },
  afterSuccess: ({ context, input, result }) => {
    // Narrowed on the input, not the result: only the single-row variant carries
    // an actor, and the two discriminants always agree.
    if (input.kind === 'single') {
      signalTableRowsChangedByActor(context.tableId, input.actorClientId)
      return
    }
    // A batch insert is not reconciled locally by the acting tab, so it must
    // refetch like every other subscriber.
    if (result.kind === 'batch' && result.rows.length > 0) signalTableRowsChanged(context.tableId)
  },
})

const MAX_REPLACE_TABLE_ROWS = 10_000

export interface ReplaceTableRowsInput extends TableScopedInput {
  /** See {@link rowWriteOptions}. Required so a new write surface must choose. */
  strictWrite: boolean
  /** See {@link TableRowDataKeying}. Required so a new write surface must choose. */
  dataKeying: TableRowDataKeying
  rows: RowData[]
  secretProvenance?: Array<TableRowSecretProvenanceWrite | undefined>
}

export interface ReplaceTableRowsResult extends TableResult, ReplaceRowsResult {}

export const replaceTableRows = defineAuthorizedTableUseCase({
  operation: tableOperations.replaceRows,
  resolveContext: ({ input }: { input: ReplaceTableRowsInput }) => resolveActiveTableContext(input),
  async execute({ principal, input, context }): Promise<ReplaceTableRowsResult> {
    if (input.rows.length > MAX_REPLACE_TABLE_ROWS) {
      throw new TableRowsValidationError(
        `Table row replacement limit exceeded: got ${input.rows.length}, max is ${MAX_REPLACE_TABLE_ROWS}`
      )
    }
    if (input.secretProvenance && input.secretProvenance.length !== input.rows.length) {
      throw new TableRowsValidationError('Secret provenance must align one-to-one with rows')
    }

    const rows = rowsToStorage(input.rows, context.table, input.dataKeying, input.strictWrite)
    const result = await replaceTableRowsPrimitive(
      {
        tableId: context.tableId,
        workspaceId: context.workspaceId,
        rows,
        userId: actorUserId(principal, context.billedAccountUserId),
        secretProvenance: defaultedRowsSecretProvenance(rows, input.secretProvenance),
      },
      context.table,
      requestId(input),
      rowWriteOptions(input)
    )
    return { table: context.table, ...result }
  },
  afterSuccess: ({ context, result }) => {
    if (result.deletedCount > 0 || result.insertedCount > 0) {
      signalTableRowsChanged(context.tableId)
    }
  },
})

const PROJECTED_WIRE_ROWS_LIMIT = 10_000
const PROJECTED_SECRET_COLUMN_TYPE_ERROR =
  'Tool output could not be persisted safely because a resolved secret is incompatible with the target column type.'

export class ProjectedWireRowsValidationError extends TableRowsValidationError {
  constructor(message: string) {
    super(message)
    this.name = 'ProjectedWireRowsValidationError'
  }
}

export interface ReplaceProjectedWireRowsInput extends TableScopedInput {
  sourceRows: Array<Record<string, unknown>>
  projectedRows: unknown
  secretProvenance?: {
    mode: 'resolved_output'
    registry?: ResolvedSecretTraceRegistry
  }
}

export interface ReplaceProjectedWireRowsResult extends TableResult, ReplaceRowsResult {}

function projectedRowsForTable(
  table: TableDefinition,
  sourceRows: Array<Record<string, unknown>>,
  value: unknown
): RowData[] {
  if (!Array.isArray(value) || !value.every(isPlainRecord)) {
    throw new ProjectedWireRowsValidationError('Table rows could not be persisted safely')
  }
  if (value.length !== sourceRows.length) {
    throw new ProjectedWireRowsValidationError(
      'Projected table rows must align one-to-one with source rows'
    )
  }
  if (value.length > PROJECTED_WIRE_ROWS_LIMIT) {
    throw new ProjectedWireRowsValidationError(
      `Table row replacement limit exceeded: got ${value.length}, max is ${PROJECTED_WIRE_ROWS_LIMIT}`
    )
  }

  const columnsByName = new Map(table.schema.columns.map((column) => [column.name, column]))
  for (let rowIndex = 0; rowIndex < value.length; rowIndex += 1) {
    const projected = value[rowIndex]
    for (const [name, projectedValue] of Object.entries(projected)) {
      const column = columnsByName.get(name)
      if (!column || isDeepStrictEqual(sourceRows[rowIndex]?.[name], projectedValue)) continue
      const type = columnTypeOf(column).id
      if (type !== 'string' && type !== 'json') {
        throw new ProjectedWireRowsValidationError(PROJECTED_SECRET_COLUMN_TYPE_ERROR)
      }
    }

    if (!Object.keys(projected).some((name) => columnsByName.has(name))) {
      throw new ProjectedWireRowsValidationError(
        `Row ${rowIndex + 1} has no keys matching columns on table "${table.name}" (columns: ${table.schema.columns.map((column) => column.name).join(', ')})`
      )
    }
  }

  const idByName = buildIdByName(table.schema)
  return value.map((row) => rowDataNameToId(row as RowData, idByName))
}

function projectedRowsSecretProvenance(
  rows: RowData[],
  workspaceId: string,
  policy: ReplaceProjectedWireRowsInput['secretProvenance']
): TableRowSecretProvenanceWrite[] {
  if (!policy) return rows.map(createExactEmptyTableRowSecretProvenance)
  const registry = policy.registry
  if (!registry) return rows.map(createUnknownTableRowSecretProvenance)

  const destinationScope = {
    workspaceId,
  }
  return rows.map((row) => {
    const provenance = createTableRowSecretProvenanceFromRegistry(row, registry)
    if (!provenance.complete) return createUnknownTableRowSecretProvenance()
    const compatible = Object.values(provenance.columns).every(
      (columnProvenance) =>
        columnProvenance.entries.length === 0 ||
        isPrivateSecretProvenanceScopeCompatible(columnProvenance.scope, destinationScope)
    )
    return compatible ? provenance : createUnknownTableRowSecretProvenance()
  })
}

/**
 * Atomically validates name-keyed projected rows against the locked schema and
 * replaces the table.
 *
 * Deliberately carries no {@link TableRowDataKeying}: unlike the six generic
 * write use cases this one is not surface-agnostic. Its resolved-secret gate and
 * its "row matches no column" check both compare by `column.name` (see
 * {@link projectedRowsForTable}), and its only caller is Copilot's
 * `Function.execute` output — keys a model can only have written as names.
 */
export const replaceProjectedWireRows = defineAuthorizedTableUseCase({
  operation: tableOperations.replaceRows,
  resolveContext: ({ input }: { input: ReplaceProjectedWireRowsInput }) =>
    resolveActiveTableContext(input),
  async execute({ principal, input, context }): Promise<ReplaceProjectedWireRowsResult> {
    if (input.sourceRows.length > PROJECTED_WIRE_ROWS_LIMIT) {
      throw new ProjectedWireRowsValidationError(
        `Table row replacement limit exceeded: got ${input.sourceRows.length}, max is ${PROJECTED_WIRE_ROWS_LIMIT}`
      )
    }
    const rowLimit = await assertRowCapacity({
      workspaceId: context.workspaceId,
      currentRowCount: 0,
      addedRows: input.sourceRows.length,
    })
    const result = await withLockedTable(
      context.tableId,
      async (table, trx) => {
        const rows = projectedRowsForTable(table, input.sourceRows, input.projectedRows)
        const provenanceRows = rows.map((row) => {
          const persistedRow = { ...row }
          coerceRowValues(persistedRow, table.schema)
          return persistedRow
        })
        const replacement = await replaceTableRowsWithTx(
          trx,
          {
            tableId: table.id,
            workspaceId: table.workspaceId,
            rows,
            userId: actorUserId(principal, context.billedAccountUserId),
            secretProvenance: projectedRowsSecretProvenance(
              provenanceRows,
              context.workspaceId,
              input.secretProvenance
            ),
          },
          table,
          requestId(input)
        )
        return { table, ...replacement }
      },
      { expectedWorkspaceId: context.workspaceId }
    )
    notifyTableRowUsage({
      workspaceId: context.workspaceId,
      currentRowCount: 0,
      addedRows: result.insertedCount,
      limit: rowLimit,
    })
    return result
  },
  projectAudit({ result }) {
    if (result.deletedCount === 0 && result.insertedCount === 0) return []
    return {
      action: AuditAction.TABLE_UPDATED,
      resourceType: AuditResourceType.TABLE,
      resourceId: result.table.id,
      resourceName: result.table.name,
      description: `Replaced rows in table "${result.table.name}"`,
      metadata: {
        op: 'replace_projected_rows',
        rowsDeleted: result.deletedCount,
        rowsInserted: result.insertedCount,
      },
    }
  },
  afterSuccess({ context, result }) {
    if (result.deletedCount > 0 || result.insertedCount > 0) {
      signalTableRowsChanged(context.tableId)
    }
  },
})

export interface UpdateTableRowInput extends TableScopedInput {
  /** See {@link rowWriteOptions}. Required so a new write surface must choose. */
  strictWrite: boolean
  /** See {@link TableRowDataKeying}. Required so a new write surface must choose. */
  dataKeying: TableRowDataKeying
  rowId: string
  data: RowData
  secretProvenance?: TableRowSecretProvenanceWrite
  /**
   * Private provenance envelope as it arrived on the wire, resolved here against
   * the canonical schema. Mutually exclusive with {@link secretProvenance}: a
   * surface either resolves its own stamp or hands over the envelope for this
   * use case to resolve, never both.
   */
  secretProvenanceEnvelope?: TableRowProvenanceEnvelope
  includePersistedSecretProvenance?: boolean
  /**
   * Tab that caused this write, when the calling surface knows it. Lets that tab
   * skip refetching its own write — see {@link signalTableRowsChangedByActor},
   * whose soundness condition is that the caller's hook reconciles the write
   * locally across every cached rows query. Only the single-row paths accept
   * one: a batch or filter-scoped write genuinely needs the acting tab to
   * refetch. Absent by default, which broadcasts to every subscriber as before.
   */
  actorClientId?: string
}

export interface UpdateTableRowResult extends TableResult {
  row: TableRow
  changed: boolean
  secretProvenance?: TableRowsProvenance
}

export const updateTableRow = defineAuthorizedTableUseCase({
  operation: tableOperations.updateRow,
  resolveContext: ({ input }: { input: UpdateTableRowInput }) => resolveActiveTableContext(input),
  async execute({ principal, input, context }): Promise<UpdateTableRowResult> {
    const data = rowDataToStorage(input.data, context.table, input.dataKeying, input.strictWrite)
    const secretProvenance = singleRowWriteProvenance({
      principal,
      workspaceId: context.workspaceId,
      table: context.table,
      input,
      storageData: data,
    })
    const row = await updateRow(
      {
        tableId: context.tableId,
        workspaceId: context.workspaceId,
        rowId: input.rowId,
        data,
        actorUserId: actorUserId(principal, context.billedAccountUserId),
        secretProvenance,
      },
      context.table,
      requestId(input),
      rowWriteOptions(input)
    )
    if (!row) throw new Error('Unconditional table row update was rejected')
    return {
      table: context.table,
      row,
      changed: Object.keys(data).length > 0,
      secretProvenance: await loadAuthorizedRowsProvenance(
        context.workspaceId,
        actorUserId(principal, context.billedAccountUserId),
        [row],
        input.includePersistedSecretProvenance
      ),
    }
  },
  afterSuccess: ({ context, input, result }) => {
    if (result.changed) signalTableRowsChangedByActor(context.tableId, input.actorClientId)
  },
})

export interface UpdateTableRowsInput extends TableScopedInput {
  /** See {@link rowWriteOptions}. Required so a new write surface must choose. */
  strictWrite: boolean
  /** See {@link TableRowDataKeying}. Required so a new write surface must choose. */
  dataKeying: TableRowDataKeying
  filter: TablePredicate
  data: RowData
  limit?: number
  secretProvenance?: TableRowSecretProvenanceWrite
}

export interface UpdateTableRowsResult extends TableResult, BulkOperationResult {}

export const updateTableRows = defineAuthorizedTableUseCase({
  operation: tableOperations.updateRows,
  resolveContext: ({ input }: { input: UpdateTableRowsInput }) => resolveActiveTableContext(input),
  async execute({ principal, input, context }): Promise<UpdateTableRowsResult> {
    try {
      if (input.limit !== undefined) {
        requireIntegerInRange(input.limit, 1, TABLE_LIMITS.MAX_BULK_OPERATION_SIZE, 'Limit')
      }
      const data = rowDataToStorage(input.data, context.table, input.dataKeying, input.strictWrite)
      const result = await updateRowsByFilter(
        context.table,
        {
          filter: tablePredicateNamesToFilter(input.filter, context.table),
          data,
          limit: input.limit,
          actorUserId: actorUserId(principal, context.billedAccountUserId),
          secretProvenance: defaultedRowSecretProvenance(data, input.secretProvenance),
        },
        requestId(input),
        rowWriteOptions(input)
      )
      return { table: context.table, ...result }
    } catch (error) {
      rethrowQueryValidation(error)
    }
  },
  afterSuccess: ({ context, result }) => {
    if (result.affectedCount > 0) signalTableRowsChanged(context.tableId)
  },
})

export interface BatchUpdateTableRowsInput extends TableScopedInput {
  /** See {@link rowWriteOptions}. Required so a new write surface must choose. */
  strictWrite: boolean
  /** See {@link TableRowDataKeying}. Required so a new write surface must choose. */
  dataKeying: TableRowDataKeying
  /** One merge patch per row. A row identifier may appear at most once. */
  updates: readonly { rowId: string; data: RowData }[]
}

export interface BatchUpdateTableRowsResult extends TableResult, BulkOperationResult {}

/**
 * Heterogeneous batch row update: a distinct merge patch per row, committed as
 * one authorized operation.
 *
 * The sibling {@link updateTableRows} applies ONE patch to every row a
 * predicate matches, so N different writes are N requests through it. This is
 * the surface-neutral home of the behavior Copilot's batch tool and the public
 * `POST /rows/bulk-update` both need: identical business semantics, so one
 * semantic operation ({@link tableOperations.updateRows}) and one use case.
 *
 * Membership is atomic. `batchUpdateRows` refuses the whole batch when a
 * `rowId` names no row in the table, which reaches the wire as a `400` listing
 * the missing ids — a caller that sent explicit identifiers is better served by
 * a refusal it can retry than by a partial commit it has to reconcile.
 *
 * The upper `CSV_MAX_BATCH_SIZE` bound is a BACKSTOP NO CURRENT SURFACE
 * REACHES, and is set to the loosest surface's ceiling on purpose so it can
 * never contradict one. Every caller is stopped earlier, by its own ceiling:
 * the internal and v2 contracts cap `updates` at
 * `TABLE_LIMITS.MAX_BULK_OPERATION_SIZE` (1000) and answer a `400` naming that
 * number, and the Copilot tool — which parses no contract — refuses past
 * `CSV_MAX_BATCH_SIZE` (5000) with a message the model can act on. The two
 * surfaces legitimately differ; what matters is that each caller sees the bound
 * that actually applies to it. This one exists for a future caller that arrives
 * with neither guard, so do not tighten it to one surface's number — that would
 * make the other surface's accepted batches start failing here.
 */
export const batchUpdateTableRows = defineAuthorizedTableUseCase({
  operation: tableOperations.updateRows,
  resolveContext: ({ input }: { input: BatchUpdateTableRowsInput }) =>
    resolveActiveTableContext(input),
  async execute({ principal, input, context }): Promise<BatchUpdateTableRowsResult> {
    if (input.updates.length < 1 || input.updates.length > CSV_MAX_BATCH_SIZE) {
      throw new OrchestrationError(
        'validation',
        `Batch update count must be between 1 and ${CSV_MAX_BATCH_SIZE}`
      )
    }
    const storageData = rowsToStorage(
      input.updates.map((update) => update.data),
      context.table,
      input.dataKeying,
      input.strictWrite
    )
    const updates = input.updates.map((update, index) => ({
      rowId: update.rowId,
      data: storageData[index],
    }))
    const result = await batchUpdateRows(
      {
        tableId: context.tableId,
        updates,
        workspaceId: context.workspaceId,
        actorUserId: actorUserId(principal, context.billedAccountUserId),
        secretProvenanceByRowId: Object.fromEntries(
          updates.map((update) => [
            update.rowId,
            createExactEmptyTableRowSecretProvenance(update.data),
          ])
        ),
      },
      context.table,
      requestId(input)
    )
    return { table: context.table, ...result }
  },
  projectAudit({ context, result }) {
    if (result.affectedCount === 0) return []
    return {
      action: AuditAction.TABLE_UPDATED,
      resourceType: AuditResourceType.TABLE,
      resourceId: context.tableId,
      resourceName: context.table.name,
      description: `Updated ${result.affectedCount} row(s) in table "${context.table.name}"`,
      metadata: { op: 'batch_update', rowsUpdated: result.affectedCount },
    }
  },
  afterSuccess({ context, result }) {
    if (result.affectedCount > 0) signalTableRowsChanged(context.tableId)
  },
})

export interface DeleteTableRowInput extends TableScopedInput {
  rowId: string
  /** See {@link UpdateTableRowInput.actorClientId}. */
  actorClientId?: string
}

export interface DeleteTableRowResult extends TableResult {
  deletedRowId: string
}

export const deleteTableRow = defineAuthorizedTableUseCase({
  operation: tableOperations.deleteRow,
  resolveContext: ({ input }: { input: DeleteTableRowInput }) => resolveActiveTableContext(input),
  async execute({ input, context }): Promise<DeleteTableRowResult> {
    await deleteRow(context.table, input.rowId, requestId(input))
    return { table: context.table, deletedRowId: input.rowId }
  },
  afterSuccess: ({ context, input }) =>
    signalTableRowsChangedByActor(context.tableId, input.actorClientId),
})

export type DeleteTableRowsInput = TableScopedInput &
  ({ kind: 'ids'; rowIds: string[] } | { kind: 'filter'; filter: TablePredicate; limit?: number })

export type DeleteTableRowsResult = TableResult &
  (({ kind: 'ids' } & BulkDeleteByIdsResult) | ({ kind: 'filter' } & BulkOperationResult))

export const deleteTableRows = defineAuthorizedTableUseCase({
  operation: tableOperations.deleteRows,
  resolveContext: ({ input }: { input: DeleteTableRowsInput }) => resolveActiveTableContext(input),
  async execute({ input, context }): Promise<DeleteTableRowsResult> {
    try {
      if (input.kind === 'ids') {
        if (input.rowIds.length < 1 || input.rowIds.length > TABLE_LIMITS.MAX_BULK_OPERATION_SIZE) {
          throw new TableRowsValidationError(
            `Row ID count must be between 1 and ${TABLE_LIMITS.MAX_BULK_OPERATION_SIZE}`
          )
        }
        const result = await deleteRowsByIds(
          context.table,
          {
            tableId: context.tableId,
            workspaceId: context.workspaceId,
            rowIds: input.rowIds,
          },
          requestId(input)
        )
        return { kind: 'ids', table: context.table, ...result }
      }
      if (input.limit !== undefined) {
        requireIntegerInRange(input.limit, 1, TABLE_LIMITS.MAX_BULK_OPERATION_SIZE, 'Limit')
      }
      const result = await deleteRowsByFilter(
        context.table,
        {
          filter: tablePredicateNamesToFilter(input.filter, context.table),
          limit: input.limit,
        },
        requestId(input)
      )
      return { kind: 'filter', table: context.table, ...result }
    } catch (error) {
      rethrowQueryValidation(error)
    }
  },
  projectAudit: ({ result }) => {
    const affected = result.kind === 'ids' ? result.deletedCount : result.affectedCount
    if (affected === 0) return []
    return {
      action: AuditAction.TABLE_UPDATED,
      resourceType: AuditResourceType.TABLE,
      resourceId: result.table.id,
      resourceName: result.table.name,
      description: `Deleted ${affected} row(s) from table "${result.table.name}"`,
      metadata: {
        op: 'bulk_delete',
        rowsDeleted: affected,
      },
    }
  },
  afterSuccess: ({ context, result }) => {
    const affected = result.kind === 'ids' ? result.deletedCount : result.affectedCount
    if (affected > 0) signalTableRowsChanged(context.tableId)
  },
})

export interface UpsertTableRowInput extends TableScopedInput {
  /** See {@link rowWriteOptions}. Required so a new write surface must choose. */
  strictWrite: boolean
  /** See {@link TableRowDataKeying}. Required so a new write surface must choose. */
  dataKeying: TableRowDataKeying
  data: RowData
  conflictTarget?: string
  secretProvenance?: TableRowSecretProvenanceWrite
  /** See {@link UpdateTableRowInput.secretProvenanceEnvelope}. */
  secretProvenanceEnvelope?: TableRowProvenanceEnvelope
  includePersistedSecretProvenance?: boolean
}

export interface UpsertTableRowResult extends TableResult {
  /** Without the executions sidecar — see {@link UpsertResult.row}. */
  row: TableRowSummary
  operation: 'insert' | 'update'
  secretProvenance?: TableRowsProvenance
}

export const upsertTableRow = defineAuthorizedTableUseCase({
  operation: tableOperations.upsertRow,
  resolveContext: ({ input }: { input: UpsertTableRowInput }) => resolveActiveTableContext(input),
  async execute({ principal, input, context }): Promise<UpsertTableRowResult> {
    // An id-keyed caller already names the storage column; only a name-keyed
    // one needs the lookup, and its miss falls through as before.
    const conflictTarget =
      input.conflictTarget && input.dataKeying !== 'ids'
        ? (buildIdByName(context.table.schema).get(input.conflictTarget) ?? input.conflictTarget)
        : input.conflictTarget
    const data = rowDataToStorage(input.data, context.table, input.dataKeying, input.strictWrite)
    const secretProvenance = singleRowWriteProvenance({
      principal,
      workspaceId: context.workspaceId,
      table: context.table,
      input,
      storageData: data,
    })
    const result = await upsertRow(
      {
        tableId: context.tableId,
        workspaceId: context.workspaceId,
        data,
        conflictTarget,
        userId: actorUserId(principal, context.billedAccountUserId),
        secretProvenance,
      },
      context.table,
      requestId(input),
      rowWriteOptions(input)
    )
    return {
      table: context.table,
      row: result.row,
      operation: result.operation,
      secretProvenance: await loadAuthorizedRowsProvenance(
        context.workspaceId,
        actorUserId(principal, context.billedAccountUserId),
        [result.row],
        input.includePersistedSecretProvenance
      ),
    }
  },
  afterSuccess: ({ context }) => signalTableRowsChanged(context.tableId),
})
