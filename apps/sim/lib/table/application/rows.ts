import { isDeepStrictEqual } from 'node:util'
import { AuditAction, AuditResourceType } from '@sim/audit'
import { requirePrincipalSubjectUserId, resolvePrincipalAttribution } from '@sim/auth/principal'
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
  Sort,
  SortSpec,
  TableDefinition,
  TablePredicate,
  TableRow,
  TableRowSecretProvenanceWrite,
} from '@/lib/table'
import {
  batchInsertRows,
  deleteRow,
  deleteRowsByFilter,
  deleteRowsByIds,
  findRowMatches,
  getRowById,
  insertRow,
  queryRows,
  replaceTableRows as replaceTableRowsPrimitive,
  rowDataNameToId,
  sortSpecNamesToIds,
  TABLE_LIMITS,
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
import { assertRowCapacity, notifyTableRowUsage } from '@/lib/table/billing'
import { buildIdByName, unknownColumnNames } from '@/lib/table/column-keys'
import { columnTypeOf } from '@/lib/table/column-types'
import { TableQueryValidationError } from '@/lib/table/errors'
import { signalTableRowsChanged } from '@/lib/table/events'
import { predicateToFilter } from '@/lib/table/query-builder/converters'
import {
  validatePredicate,
  validatePredicateShape,
  validateSortSpec,
  validateStoragePredicate,
} from '@/lib/table/query-builder/validate'
import { assertCursorQueryBinding, decodeCursor } from '@/lib/table/rows/cursor'
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
  /**
   * Whether the calling surface publishes the stricter `/api/v2` write contract:
   * a row naming a column the table does not have is refused rather than having
   * that key dropped, and a value the column's type cannot coerce is answered
   * with a 400 rather than stored as `null`.
   *
   * Absent — every first-party surface, and the only behavior any of them has
   * ever had: the workspace grid, the internal `/api/table` routes, `/api/v1`,
   * the Copilot table tools, and the executor's Table block all drop the
   * unknown key and blank the uncoercible cell. Read-only use cases ignore it.
   */
}

/** The write policy `strictWrite` selects, for the row-service primitives. */
function rowWriteOptions(input: { strictWrite: boolean }): RowWriteOptions {
  return input.strictWrite ? { uncoercibleValues: 'reject' } : {}
}

interface TableResult {
  table: TableDefinition
}

type TableRowsProvenance = Awaited<ReturnType<typeof loadTableRowSecretProvenance>>

async function loadAuthorizedRowsProvenance(
  principal: Parameters<typeof requirePrincipalSubjectUserId>[0],
  workspaceId: string,
  rows: TableRow[],
  include: boolean | undefined
): Promise<TableRowsProvenance | undefined> {
  if (!include) return undefined
  return loadTableRowSecretProvenance(rows, {
    userId: requirePrincipalSubjectUserId(principal),
    workspaceId,
  })
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
 * `strictWrite` caller — see {@link TableScopedInput.strictWrite}.
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
  const unknown = unknownColumnNames(data, idByName)
  if (unknown.length === 0) return
  const where = rowLabel ? `${rowLabel}: ` : ''
  throw new TableRowsValidationError(
    `${where}Unknown column${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}`
  )
}

function namedDataToStorage(data: RowData, table: TableDefinition, strict = false): RowData {
  const idByName = buildIdByName(table.schema)
  if (strict) assertKnownColumnNames(data, idByName)
  return rowDataNameToId(data, idByName)
}

/**
 * {@link namedDataToStorage} over a batch. The name index is built once for the
 * whole batch rather than per row — these paths run over up to
 * `MAX_BATCH_INSERT_SIZE` rows.
 */
function namedRowsToStorage(
  rows: readonly RowData[],
  table: TableDefinition,
  strict = false
): RowData[] {
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

export interface ListTableRowsInput extends TableScopedInput {
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
          withExecutions: false,
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

export interface QueryTableRowsInput extends TableScopedInput {
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
          withExecutions: false,
        },
        requestId(input)
      )
      return {
        table: context.table,
        ...result,
        secretProvenance: await loadAuthorizedRowsProvenance(
          principal,
          context.workspaceId,
          result.rows,
          input.includePersistedSecretProvenance
        ),
      }
    } catch (error) {
      rethrowQueryValidation(error)
    }
  },
})

export interface FindTableRowsInput extends TableScopedInput {
  q: string
  predicate?: TablePredicate
  sort?: SortSpec
}

export interface FindTableRowsResult extends TableResult {
  matches: FindRowMatch[]
  truncated: boolean
}

export const findTableRows = defineAuthorizedTableUseCase({
  operation: tableOperations.findRows,
  resolveContext: ({ input }: { input: FindTableRowsInput }) => resolveActiveTableContext(input),
  async execute({ input, context }): Promise<FindTableRowsResult> {
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

export interface ReadTableRowInput extends TableScopedInput {
  rowId: string
  includePersistedSecretProvenance?: boolean
}

export interface ReadTableRowResult extends TableResult {
  row: TableRow
  secretProvenance?: TableRowsProvenance
}

export const readTableRow = defineAuthorizedTableUseCase({
  operation: tableOperations.readRow,
  resolveContext: ({ input }: { input: ReadTableRowInput }) => resolveActiveTableContext(input),
  async execute({ principal, input, context }): Promise<ReadTableRowResult> {
    const row = await getRowById(context.tableId, input.rowId, context.workspaceId)
    if (!row) throw new OrchestrationError('not_found', 'Row not found')
    return {
      table: context.table,
      row,
      secretProvenance: await loadAuthorizedRowsProvenance(
        principal,
        context.workspaceId,
        [row],
        input.includePersistedSecretProvenance
      ),
    }
  },
})

interface CreateSingleTableRowInput extends TableScopedInput {
  /** See {@link rowWriteOptions}. Required so a new write surface must choose. */
  strictWrite: boolean
  kind: 'single'
  data: RowData
  position?: number
  afterRowId?: string
  beforeRowId?: string
  secretProvenance?: TableRowSecretProvenanceWrite
}

interface CreateBatchTableRowsInput extends TableScopedInput {
  /** See {@link rowWriteOptions}. Required so a new write surface must choose. */
  strictWrite: boolean
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
      const data = namedDataToStorage(input.data, context.table, input.strictWrite)
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
    const rows = namedRowsToStorage(input.rows, context.table, input.strictWrite)
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
  afterSuccess: ({ context, result }) => {
    const affected = result.kind === 'single' ? 1 : result.rows.length
    if (affected > 0) signalTableRowsChanged(context.tableId)
  },
})

const MAX_REPLACE_TABLE_ROWS = 10_000

export interface ReplaceTableRowsInput extends TableScopedInput {
  /** See {@link rowWriteOptions}. Required so a new write surface must choose. */
  strictWrite: boolean
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

    const rows = namedRowsToStorage(input.rows, context.table, input.strictWrite)
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
  principal: Parameters<typeof requirePrincipalSubjectUserId>[0],
  workspaceId: string,
  policy: ReplaceProjectedWireRowsInput['secretProvenance']
): TableRowSecretProvenanceWrite[] {
  if (!policy) return rows.map(createExactEmptyTableRowSecretProvenance)
  const registry = policy.registry
  if (!registry) return rows.map(createUnknownTableRowSecretProvenance)

  const destinationScope = {
    userId: requirePrincipalSubjectUserId(principal),
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

/** Atomically validates name-keyed projected rows against the locked schema and replaces the table. */
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
              principal,
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
  rowId: string
  data: RowData
  secretProvenance?: TableRowSecretProvenanceWrite
  includePersistedSecretProvenance?: boolean
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
    const data = namedDataToStorage(input.data, context.table, input.strictWrite)
    const row = await updateRow(
      {
        tableId: context.tableId,
        workspaceId: context.workspaceId,
        rowId: input.rowId,
        data,
        actorUserId: actorUserId(principal, context.billedAccountUserId),
        secretProvenance: defaultedRowSecretProvenance(data, input.secretProvenance),
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
        principal,
        context.workspaceId,
        [row],
        input.includePersistedSecretProvenance
      ),
    }
  },
  afterSuccess: ({ context, result }) => {
    if (result.changed) signalTableRowsChanged(context.tableId)
  },
})

export interface UpdateTableRowsInput extends TableScopedInput {
  /** See {@link rowWriteOptions}. Required so a new write surface must choose. */
  strictWrite: boolean
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
      const data = namedDataToStorage(input.data, context.table, input.strictWrite)
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

export interface DeleteTableRowInput extends TableScopedInput {
  rowId: string
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
  afterSuccess: ({ context }) => signalTableRowsChanged(context.tableId),
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
  data: RowData
  conflictTarget?: string
  secretProvenance?: TableRowSecretProvenanceWrite
}

export interface UpsertTableRowResult extends TableResult {
  row: TableRow
  operation: 'insert' | 'update'
}

export const upsertTableRow = defineAuthorizedTableUseCase({
  operation: tableOperations.upsertRow,
  resolveContext: ({ input }: { input: UpsertTableRowInput }) => resolveActiveTableContext(input),
  async execute({ principal, input, context }): Promise<UpsertTableRowResult> {
    const conflictTarget = input.conflictTarget
      ? (buildIdByName(context.table.schema).get(input.conflictTarget) ?? input.conflictTarget)
      : undefined
    const data = namedDataToStorage(input.data, context.table, input.strictWrite)
    const result = await upsertRow(
      {
        tableId: context.tableId,
        workspaceId: context.workspaceId,
        data,
        conflictTarget,
        userId: actorUserId(principal, context.billedAccountUserId),
        secretProvenance: defaultedRowSecretProvenance(data, input.secretProvenance),
      },
      context.table,
      requestId(input),
      rowWriteOptions(input)
    )
    return { table: context.table, row: result.row, operation: result.operation }
  },
  afterSuccess: ({ context }) => signalTableRowsChanged(context.tableId),
})
