import { getErrorMessage } from '@sim/utils/errors'
import { executeOracleStatements } from '@/lib/internal/oracledb/client'
import { executeOracleIntrospect } from '@/lib/internal/oracledb/introspection'
import {
  buildOracleDelete,
  buildOracleInsert,
  buildOracleUpdate,
  getOracleStatementType,
  normalizeOracleSql,
  validateOracleExecuteQuery,
  validateOracleReadOnlyQuery,
} from '@/lib/internal/oracledb/query'
import {
  capOracleResult,
  ORACLE_MAX_RESULT_ROWS,
  toOracleRowsResponseBody,
} from '@/lib/internal/oracledb/result-normalization'
import type {
  OracleConnectionInput,
  OracleDeleteInput,
  OracleExecuteInput,
  OracleInsertInput,
  OracleIntrospectInput,
  OracleQueryInput,
  OracleUpdateInput,
} from '@/lib/internal/oracledb/schema'

export class OracleOperationInputError extends Error {}

function connectionFromInput(input: OracleConnectionInput): OracleConnectionInput {
  return {
    host: input.host,
    port: input.port,
    protocol: input.protocol,
    connectionType: input.connectionType,
    username: input.username,
    password: input.password,
    connectionTimeout: input.connectionTimeout,
    ...(input.serviceName !== undefined && { serviceName: input.serviceName }),
    ...(input.sid !== undefined && { sid: input.sid }),
    ...(input.walletContent !== undefined && { walletContent: input.walletContent }),
    ...(input.walletPassword !== undefined && { walletPassword: input.walletPassword }),
  }
}

function requireValidQuery(query: string, readOnly: boolean): string {
  const validation = readOnly
    ? validateOracleReadOnlyQuery(query)
    : validateOracleExecuteQuery(query)
  if (!validation.isValid) {
    throw new OracleOperationInputError(
      `Query validation failed: ${validation.error ?? 'Invalid Oracle SQL'}`
    )
  }
  return normalizeOracleSql(query)
}

function buildStatement(
  operation: 'insert' | 'update' | 'delete',
  build: () => { sql: string; binds: Record<string, string | number | null> }
) {
  try {
    return build()
  } catch (error) {
    throw new OracleOperationInputError(
      `Oracle Database ${operation} failed: ${getErrorMessage(error, 'Invalid statement')}`
    )
  }
}

export async function executeOracleQuery(input: OracleQueryInput, signal?: AbortSignal) {
  const sql = requireValidQuery(input.query, true)
  const [workerResult] = await executeOracleStatements(
    connectionFromInput(input),
    [{ sql, binds: input.binds, maxRows: ORACLE_MAX_RESULT_ROWS }],
    { readOnlyTransaction: true },
    signal
  )
  const result = capOracleResult(workerResult)
  return toOracleRowsResponseBody(
    result,
    `Query executed successfully. ${result.rowCount} row(s) returned.`
  )
}

export async function executeOracleStatement(input: OracleExecuteInput, signal?: AbortSignal) {
  const sql = requireValidQuery(input.query, false)
  const statementType = getOracleStatementType(sql)
  const [workerResult] = await executeOracleStatements(
    connectionFromInput(input),
    [
      {
        sql,
        binds: input.binds,
        autoCommit: statementType !== 'SELECT',
        maxRows: ORACLE_MAX_RESULT_ROWS,
      },
    ],
    { readOnlyTransaction: statementType === 'SELECT' },
    signal
  )
  const result = capOracleResult(workerResult)
  return toOracleRowsResponseBody(
    result,
    statementType === 'SELECT'
      ? `SQL executed successfully. ${result.rowCount} row(s) returned.`
      : `SQL executed successfully. ${result.rowCount} row(s) affected.`
  )
}

export async function executeOracleInsert(input: OracleInsertInput, signal?: AbortSignal) {
  const statement = buildStatement('insert', () =>
    buildOracleInsert(input.schema, input.table, input.data)
  )
  const [workerResult] = await executeOracleStatements(
    connectionFromInput(input),
    [{ ...statement, autoCommit: true, maxRows: ORACLE_MAX_RESULT_ROWS }],
    {},
    signal
  )
  const result = capOracleResult(workerResult)
  return toOracleRowsResponseBody(
    result,
    `Data inserted successfully. ${result.rowCount} row(s) affected.`
  )
}

export async function executeOracleUpdate(input: OracleUpdateInput, signal?: AbortSignal) {
  const statement = buildStatement('update', () =>
    buildOracleUpdate(input.schema, input.table, input.data, input.where)
  )
  const [workerResult] = await executeOracleStatements(
    connectionFromInput(input),
    [{ ...statement, autoCommit: true, maxRows: ORACLE_MAX_RESULT_ROWS }],
    {},
    signal
  )
  const result = capOracleResult(workerResult)
  return toOracleRowsResponseBody(
    result,
    `Data updated successfully. ${result.rowCount} row(s) affected.`
  )
}

export async function executeOracleDelete(input: OracleDeleteInput, signal?: AbortSignal) {
  const statement = buildStatement('delete', () =>
    buildOracleDelete(input.schema, input.table, input.where)
  )
  const [workerResult] = await executeOracleStatements(
    connectionFromInput(input),
    [{ ...statement, autoCommit: true, maxRows: ORACLE_MAX_RESULT_ROWS }],
    {},
    signal
  )
  const result = capOracleResult(workerResult)
  return toOracleRowsResponseBody(
    result,
    `Data deleted successfully. ${result.rowCount} row(s) affected.`
  )
}

export async function executeOracleIntrospection(
  input: OracleIntrospectInput,
  signal?: AbortSignal
) {
  const result = await executeOracleIntrospect(connectionFromInput(input), input, signal)
  const message = `Schema introspection completed. Found ${result.tables.length} table(s) in schema '${result.schema}'.${
    result.truncated
      ? ' Metadata was limited by the 1,000-table, 10,000-column, or 10 MiB ceiling.'
      : ''
  }`
  return {
    message,
    tables: result.tables,
    schemas: result.schemas,
  }
}

export const oracleOperationInternals = {
  connectionFromInput,
}
